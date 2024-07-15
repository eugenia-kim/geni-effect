import { Effect, Console, Either, Context, pipe } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import { BunFileSystem } from "@effect/platform-bun";
import {
  String,
  Boolean,
  type Schema,
  Number,
  Array,
  Struct,
} from "@effect/schema/Schema";
import { JSONSchema } from "@effect/schema";
import OpenAI from "openai";
import { sha1 } from "js-sha1";
import * as ts from "typescript";
import { generateFunctionPrompt, retryGenerateFunctionPrompt } from "./prompt";
import type { BunFile } from "bun";

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

function typecheck<Input extends unknown[], Output>(
  fileName: string,
  inputs: InputSchema<Input>,
  output: Schema<Output>
) {
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
    return Either.left(
      `Type check failed: ${allDiagnostics
        .map((d) => ts.flattenDiagnosticMessageText(d, "\n"))
        .join("\n")}`
    );
  }
  return Either.right("success");
}

export const genericGeni = <Input extends unknown[], Output>(
  description: string,
  inputs: InputSchema<Input>,
  output: Schema<Output>
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const hash = sha1(`${description}:${inputs}:${output}`);
    let attempt = 0;
    const tempDir = `${TEMP_DIR}/${hash}`;
    const wrapperCode = `const wrapper: (${inputs
      .map((input, i) => `arg${i}: ${input}`)
      .join(", ")}) => ${output} = main;`;
    const finalFile = `${DIR}/${hash}.ts`;
    yield* fs.makeDirectory(tempDir, { recursive: true });

    let retries = 3;
    let previousAttempts: Array<{ response: string; error: string }> = [];
    while (attempt < retries) {
      const func: string = yield* generateFunction(
        description,
        inputs,
        output,
        previousAttempts
      );
      const r = `${func}\n${wrapperCode}`;
      const tempFileName = `${tempDir}/${attempt}.ts`;
      yield* fs.writeFileString(tempFileName, r);
      const status = typecheck(tempFileName, inputs, output);
      if (Either.isLeft(status)) {
        previousAttempts.push({ response: r, error: status.left });
        attempt++;
      } else {
        yield* fs.writeFileString(finalFile, r);
        return (...args: Input) => {
          const toEval = `${r} \n wrapper(${args
            .map((arg) => JSON.stringify(arg))
            .join(", ")}); `;
          return eval(ts.transpile(toEval));
        };
      }
    }
    throw new Error("Failed to generate function");
  });

const geni = <Input extends unknown[], Output>(
  description: string,
  inputs: InputSchema<Input>,
  output: Schema<Output>
) =>
  Effect.runPromise(
    pipe(
      genericGeni(description, inputs, output),
      provideChatGPT,
      Effect.provide(BunFileSystem.layer)
    )
  );

const Person = Struct({
  name: String,
  age: Number,
});

const welcome = await geni("Return the oldest person", [Array(Person)], Person);

console.log(
  welcome([
    { name: "anton", age: 30 },
    { name: "geni", age: 28 },
  ])
);
