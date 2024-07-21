import { Effect, Either, Context, pipe } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import { BunFileSystem } from "@effect/platform-bun";
import {
  String,
  type Schema,
  Number,
  Array,
  Struct,
  encodeSync,
} from "@effect/schema/Schema";
import OpenAI from "openai";
import { sha1 } from "js-sha1";
import * as ts from "typescript";
import { generateFunctionPrompt, retryGenerateFunctionPrompt } from "./prompt";
import _ from "lodash";
import type { PlatformError } from "@effect/platform/Error";
import { catchAll, mapError } from "effect/Effect";
import { validateCachedFunction, validate } from "./validate";
import { LLM, type InputSchema } from "./types";
import { generate } from "./generate";

const RETRIES = 5;
const DIR = ".geni";
const TEMP_DIR = ".geni/temp";

export const provideChatGPT = Effect.provideService(LLM, {
  request: (prompt: string) =>
    Effect.gen(function* () {
      const openai = new OpenAI();

      const completion = yield* Effect.tryPromise(() =>
        openai.chat.completions.create({
          messages: [{ role: "system", content: prompt }],
          model: "gpt-4o",
        })
      );

      return completion.choices[0].message.content || "";
    }),
});

const provideMockLLM = Effect.provideService(LLM, {
  request: (prompt: string) =>
    Effect.gen(function* () {
      return `function main(people: ReadonlyArray<{ readonly name: string; readonly age: number }>): string {
        return people.map(person => \`Welcome \${person.name}, age \${person.age}!\`).join(' ');
    }`;
    }),
});

function toRunnable<Input extends unknown[], Output>(
  generatedCode: string,
  output: Schema<Output>
) {
  return (...args: Input): Output => {
    const toEval = `${generatedCode} \n wrapper(${args
      .map((arg) => JSON.stringify(arg))
      .join(", ")}); `;
    return encodeSync(output)(eval(ts.transpile(toEval)));
  };
}

function getPreviousAttempts(hash: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const tempDir = `${TEMP_DIR}/${hash}`;
    const files: readonly string[] = yield* fs
      .readDirectory(tempDir)
      .pipe(catchAll((e) => Effect.succeed([] as const)));
    if (files.length === 0) {
      return 0;
    }
    const fileName = files[files.length - 1];
    const regex = /(\d+)\.ts/; // Match one or more digits (\d+) followed by ".ts"
    const match = fileName.match(regex);

    if (match) {
      const extractedNumber = match[1]; // The first capturing group contains the number
      return +extractedNumber + 1;
    }
    return 0;
  });
}

export const genericGeni = <Input extends unknown[], Output>(
  description: string,
  inputs: InputSchema<Input>,
  output: Schema<Output>,
  tests: Array<{
    input: Input;
    output: Output;
  }> = []
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const hash = sha1(`${description}:${inputs}:${output}`);
    const finalFile = `${DIR}/${hash}.ts`;
    if (yield* fs.exists(finalFile)) {
      const result: Either.Either<string, string | PlatformError> =
        yield* Effect.either(validateCachedFunction(finalFile, output, tests));
      if (Either.isRight(result)) {
        return toRunnable(result.right, output);
      } else {
        // delete the final file as we need to re-generate one
        fs.remove(finalFile);
      }
    }
    let attempt = yield* getPreviousAttempts(hash);
    const tempDir = `${TEMP_DIR}/${hash}`;
    yield* fs.makeDirectory(tempDir, { recursive: true });

    let previousAttempts: Array<{ response: string; error: string }> = [];

    const generateFunctionProgram = Effect.gen(function* () {
      const tempFileName = `${tempDir}/${attempt++}.ts`;
      const r = yield* generate(description, inputs, output, previousAttempts);
      yield* fs.writeFileString(tempFileName, r);

      return yield* Effect.matchEffect(validate(tempFileName, output, tests), {
        onFailure: (e) => {
          // TODO: propagate the PlatformError
          const error = typeof e === "string" ? e : e.message;
          previousAttempts.push({ response: r, error });
          console.log(error);
          return Effect.fail(error);
        },
        onSuccess: () => Effect.succeed(r),
      });
    });

    let result = "";
    try {
      result = yield* Effect.retry(generateFunctionProgram, {
        times: RETRIES,
      });
    } catch (e) {
      throw new Error("Failed to generate function");
    }
    yield* fs.writeFileString(finalFile, result);
    return toRunnable(result, output);
  });

export const geni = <Input extends unknown[], Output>(
  description: string,
  inputs: InputSchema<Input>,
  output: Schema<Output>,
  tests: Array<{
    input: NoInfer<Input>;
    output: NoInfer<Output>;
  }>
) =>
  Effect.runPromise(
    pipe(
      genericGeni(description, inputs, output, tests),
      provideChatGPT,
      Effect.provide(BunFileSystem.layer),
      Effect.withSpan("geni")
    )
  );

const Person = Struct({
  name: String,
  age: Number,
});

const welcome = await geni(
  "Return the oldest person",
  [Array(Person)],
  Person,
  [
    {
      input: [
        [
          { name: "anton", age: 30 },
          { name: "geni", age: 28 },
        ] as const,
      ],
      output: { name: "anton", age: 30 },
    },
    {
      input: [
        [
          { name: "geni", age: 28 },
          { name: "dave", age: 39 },
          { name: "deniz", age: 35 },
        ] as const,
      ],
      output: { name: "dave", age: 39 },
    },
  ]
);
const o = welcome([
  { name: "anton", age: 30 },
  { name: "geni", age: 28 },
]);
console.log(o);
