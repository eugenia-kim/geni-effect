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

const RETRIES = 5;
const DIR = ".geni";
const TEMP_DIR = ".geni/temp";

class LLM extends Context.Tag("LLM")<
  LLM,
  { readonly request: (prompt: string) => Effect.Effect<string, Error> }
>() {}

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

type InputSchema<Input> = { [I in keyof Input]: Schema<Input[I]> };

const generateFunction = <Input, Output>(
  description: string,
  input: InputSchema<Input>,
  output: Schema<Output>,
  previousAttempts: Array<{
    response: string;
    error: string;
  }> = []
) =>
  Effect.gen(function* () {
    const llm = yield* LLM;
    console.log("openAI request");
    const result = previousAttempts.length
      ? yield* llm.request(
          retryGenerateFunctionPrompt(
            description,
            input,
            output,
            previousAttempts
          )
        )
      : yield* llm.request(generateFunctionPrompt(description, input, output));
    return result;
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

// type check and tests
const validate = <Input extends unknown[], Output>(
  fileName: string,
  outputSchema: Schema<Output>,
  tests: Array<{
    input: Input;
    output: Output;
  }> = []
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const generatedCode = yield* fs.readFileString(fileName);
    const program = ts.createProgram([fileName], {});
    let emitResult = program.emit();
    let allDiagnostics = ts
      .getPreEmitDiagnostics(program)
      .concat(emitResult.diagnostics)
      .flatMap((diagnostic) => {
        if (diagnostic.file) {
          return diagnostic.file.fileName === fileName
            ? diagnostic.messageText
            : [];
        }
        return [];
      });
    if (allDiagnostics.length > 0) {
      yield* Effect.fail(
        `Type check failed: ${allDiagnostics
          .map((d) => ts.flattenDiagnosticMessageText(d, "\n"))
          .join("\n")}`
      );
    }

    const failed = [];
    const runnable = toRunnable(generatedCode, outputSchema);
    for (const test of tests) {
      const actual = runnable(...test.input);
      if (!_.isEqual(test.output, actual)) {
        failed.push({ input: test.input, expected: test.output, actual });
      }
    }
    if (failed.length > 0) {
      yield* Effect.fail(
        `${failed.length}\/${
          tests.length
        } tests failed. Failed test cases: ${JSON.stringify(failed)}`
      );
    }
    return generatedCode;
  });

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

const validateCachedFunction = <Input extends unknown[], Output>(
  fileName: string,
  outputSchema: Schema<Output>,
  tests: Array<{
    input: Input;
    output: Output;
  }> = []
) =>
  validate(fileName, outputSchema, tests).pipe(
    mapError((e) => {
      if (typeof e === "string") {
        return (
          "Cached function is outdated. Need to regenerate one. See error: " + e
        );
      } else {
        return e;
      }
    })
  );

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
    const wrapperCode = `const wrapper: (${inputs
      .map((input, i) => `arg${i}: ${input}`)
      .join(", ")}) => ${output} = main;`;
    yield* fs.makeDirectory(tempDir, { recursive: true });

    let previousAttempts: Array<{ response: string; error: string }> = [];

    const generateFunctionProgram = Effect.gen(function* () {
      const func: string = yield* generateFunction(
        description,
        inputs,
        output,
        previousAttempts
      );
      const r = `${func}\n${wrapperCode}`;
      const tempFileName = `${tempDir}/${attempt++}.ts`;
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
