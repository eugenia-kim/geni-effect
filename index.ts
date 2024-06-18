import { Effect, Console } from "effect";
import { String, Boolean, type Schema, Number, Array, Struct } from "@effect/schema/Schema";
import { JSONSchema } from "@effect/schema";
import OpenAI from "openai";
import { sha1 } from "js-sha1";
import * as ts from "typescript";

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
) {
  console.log("openAI request");
  return request(`
  Generate a fully typed typescript function based on the given description, input schema and output schema to be passed into eval function.
Example:

description: 'Return a happy birthday message to the person mentioning the age.' 
input: { readonly name: string; readonly age: number }
output: string

function main(person: { readonly name: string; readonly age: number }): string {
  return \`Happy birthday \${person.name}. You're now \${person.age} years old\`
}

  
Make sure the function is called 'main'. 
Make sure the response is in a text format.Not a code block.
Generate a single function with the following description, input and output schema:
description: ${description}
input: ${input}
output: ${output}
`);
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
  const file = Bun.file(`.geni/${hash}.ts`);
  const result = await (async () => {
    if (await file.exists()) {
      return file.text();
    }
    const r =
      `${await generateFunction(description, inputs, output)}
const wrapper: (${inputs.map((input, i) => `arg${i}: ${input}`).join(", ")}) => ${output} = main;`;
    Bun.write(file, r);
    typecheck(`.geni/${hash}.ts`, inputs, output);
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