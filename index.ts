import { Effect, Console } from "effect";
import { String, Boolean, type Schema, Number, Array, Struct } from "@effect/schema/Schema";
import { JSONSchema } from "@effect/schema";
import OpenAI from "openai";
import { sha1 } from "js-sha1";
import * as ts from "typescript";
import { generateFunctionPrompt, retryGenerateFunctionPrompt } from "./prompt";

const openai = new OpenAI();

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

function typecheck<Input extends unknown[], Output>(fileName: string, inputs: InputSchema<Input>, output: Schema<Output>) {
  const program = ts.createProgram([fileName], {});
  let emitResult = program.emit();
  let allDiagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(emitResult.diagnostics)
    .flatMap(diagnostic => {
      if (diagnostic.file) {
        return diagnostic.file.fileName === fileName ? diagnostic.messageText : []
      }
      return [];
    });
  if (allDiagnostics.length > 0) {
    throw new Error(`Type check failed: ${allDiagnostics.map(d => ts.flattenDiagnosticMessageText(d, "\n")).join("\n")}`);
  }
}

export async function geni<Input extends unknown[], Output>(
  description: string,
  inputs: InputSchema<Input>,
  output: Schema<Output>,
): Promise<(...input: Input) => Output> {
  const hash = sha1(`${description}:${inputs}:${output}`);
  const fileName = `.geni/${hash}.ts`;
  const file = Bun.file(fileName);
  const wrapperCode = `const wrapper: (${inputs.map((input, i) => `arg${i}: ${input}`).join(", ")}) => ${output} = main;`;

  const generateAndWrite = async (previousAttempts: Array<{ response: string, error: string }>) => {
    const r = `${await generateFunction(description, inputs, output, previousAttempts)}\n${wrapperCode}`;
    Bun.write(file, r);
    typecheck(fileName, inputs, output);
    return r;
  };
  const result = await (async () => {
    if (await file.exists()) {
      return await file.text();
    }
    let retries = 3;
    let previousAttempts: Array<{ response: string, error: string }> = [];
    let r = '';
    while (retries > 0) {
      try {
        r = await generateAndWrite(previousAttempts);
        break;
      } catch (e: unknown) {
        previousAttempts.push({ response: r, error: (e as Error).message });
      }
      retries--;
    }
    return r;
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