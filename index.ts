import { Effect, Console, Either, Context, pipe } from "effect";
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

const provideChatGPT = Effect.provideService(LLM, {
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
  file: BunFile,
  inputs: InputSchema<Input>,
  output: Schema<Output>
) {
  const program = ts.createProgram([file.name || ""], {});
  let emitResult = program.emit();
  let allDiagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(emitResult.diagnostics)
    .flatMap((diagnostic) => {
      if (diagnostic.file) {
        return diagnostic.file.fileName === file.name
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

export async function geni<Input extends unknown[], Output>(
  description: string,
  inputs: InputSchema<Input>,
  output: Schema<Output>
): Promise<(...input: Input) => Output> {
  const hash = sha1(`${description}:${inputs}:${output}`);
  let attempt = 0;
  const tempDir = `${TEMP_DIR}/${hash}`;
  const wrapperCode = `const wrapper: (${inputs
    .map((input, i) => `arg${i}: ${input}`)
    .join(", ")}) => ${output} = main;`;
  const finalFile = Bun.file(`${DIR}/${hash}.ts`);

  const result = await (async () => {
    if (await finalFile.exists()) {
      return await finalFile.text();
    }
    let retries = 3;
    let previousAttempts: Array<{ response: string; error: string }> = [];
    let r = "";
    while (attempt < retries) {
      const result = await (async () => {
        const func = await Effect.runPromise(
          pipe(
            generateFunction(description, inputs, output, previousAttempts),
            provideMockLLM
          )
        );
        const r = `${func}\n${wrapperCode}`;
        const tempFile = Bun.file(`${tempDir}/${attempt}.ts`);
        Bun.write(tempFile, r);
        return { response: r, status: typecheck(tempFile, inputs, output) };
      })();
      r = result.response;
      if (Either.isLeft(result.status)) {
        previousAttempts.push({ response: r, error: result.status.left });
        attempt++;
      } else {
        Bun.write(finalFile, r);
        return r;
      }
    }
    throw new Error("Failed to generate function");
  })();

  return (...args: Input) => {
    const toEval = `${result} \n wrapper(${args
      .map((arg) => JSON.stringify(arg))
      .join(", ")}); `;
    return eval(ts.transpile(toEval));
  };
}

const Person = Struct({
  name: String,
  age: Number,
});

const welcome = await geni(
  "Write a welcome message to people in the input array mentioning their names and ages",
  [Array(Person)],
  String
);

console.log(
  welcome([
    { name: "anton", age: 30 },
    { name: "geni", age: 28 },
  ])
);
