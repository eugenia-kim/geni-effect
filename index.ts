import { Effect, Console, Either } from "effect";
import { String, Boolean, type Schema, Number, Array, Struct } from "@effect/schema/Schema";
import { JSONSchema } from "@effect/schema";
import OpenAI from "openai";
import { sha1 } from "js-sha1";
import * as ts from "typescript";
import { generateFunctionPrompt, retryGenerateFunctionPrompt } from "./prompt";
import type { BunFile } from "bun";

const openai = new OpenAI();

const DIR = ".geni";
const TEMP_DIR = '.geni/temp';

async function request(prompt: string) {
  const completion = await openai.chat.completions.create({
    messages: [{ role: "system", content: prompt }],
    model: "gpt-4o",
  });

  return completion.choices[0].message.content || "";
}

type InputSchema<Input> = { [I in keyof Input]: Schema<Input[I]> };

async function generateFunction<Input, Output>(
  description: string,
  input: InputSchema<Input>,
  output: Schema<Output>,
  previousAttempts: Array<{
    response: string,
    error: string,
  }> = [],
) {
  console.log("openAI request");
  if (previousAttempts.length) {
    return request(retryGenerateFunctionPrompt(description, input, output, previousAttempts));
  }
  return request(generateFunctionPrompt(description, input, output));
}

function typecheck<Input extends unknown[], Output>(file: BunFile, inputs: InputSchema<Input>, output: Schema<Output>) {
  const program = ts.createProgram([file.name || ''], {});
  let emitResult = program.emit();
  let allDiagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(emitResult.diagnostics)
    .flatMap(diagnostic => {
      if (diagnostic.file) {
        return diagnostic.file.fileName === file.name ? diagnostic.messageText : []
      }
      return [];
    });
  if (allDiagnostics.length > 0) {
    return Either.left(`Type check failed: ${allDiagnostics.map(d => ts.flattenDiagnosticMessageText(d, "\n")).join("\n")}`);
  }
  return Either.right('success');
}

export async function geni<Input extends unknown[], Output>(
  description: string,
  inputs: InputSchema<Input>,
  output: Schema<Output>,
): Promise<(...input: Input) => Output> {
  const hash = sha1(`${description}:${inputs}:${output}`);
  let attempt = 0;
  const tempDir = `${TEMP_DIR}/${hash}`;
  const wrapperCode = `const wrapper: (${inputs.map((input, i) => `arg${i}: ${input}`).join(", ")}) => ${output} = main;`;
  const finalFile = Bun.file(`${DIR}/${hash}.ts`);

  const result = await (async () => {
    if (await finalFile.exists()) {
      return await finalFile.text();
    }
    let retries = 3;
    let previousAttempts: Array<{ response: string, error: string }> = [];
    let r = '';
    while (attempt < retries) {
      const result = await (async () => {
        const r = `${await generateFunction(description, inputs, output, previousAttempts)}\n${wrapperCode}`;
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
    throw new Error('Failed to generate function');
  })();

  return (...args: Input) => {
    const toEval = `${result} \n wrapper(${args.map((arg) => JSON.stringify(arg)).join(", ")}); `;
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
  String,
);

console.log(
  welcome(
    [
      { name: 'anton', age: 30 },
      { name: 'geni', age: 28 },
    ]
  ),
);