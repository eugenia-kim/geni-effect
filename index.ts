import { Effect, Console } from "effect";
import * as S from "@effect/schema/Schema";
import { JSONSchema } from "@effect/schema";
import OpenAI from "openai";
import { sha1 } from "js-sha1";

const openai = new OpenAI();

async function request(prompt: string) {
  const completion = await openai.chat.completions.create({
    messages: [{ role: "system", content: prompt }],
    model: "gpt-4o",
  });

  return completion.choices[0].message.content || "";
  // return `
  // function main(arrays) {
  //   return [...arrays.fst, ...arrays.snd];
  // } 
  // `;
}

const TwoArrays = S.Struct({
  fst: S.Array(S.Number),
  snd: S.Array(S.Number),
});

type TwoArraysType = S.Schema.Type<typeof TwoArrays>; ``

type InputSchema<Input> = { [I in keyof Input]: S.Schema<Input[I]> };

async function generateFunction<Input, Output>(description: string, input: InputSchema<Input>, output: S.Schema<Output>) {
  return await request(`
  Generate a javascript function based on the given description, input schema and output schema to be passed into eval function.
Example:

description: 'Return a happy birthday message to the person mentioning the age.' 
input: { readonly name: string; readonly age: number }
output: string

function main(person) {
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


async function geni<Input extends unknown[], Output>(
  description: string,
  inputs: InputSchema<Input>,
  output: S.Schema<Output>
): Promise<(...input: Input) => Output> {
  const hash = sha1(`${description}:${inputs}:${output}`);
  const file = Bun.file(`.geni/${hash}.js`);
  const result = await (async () => {
    if (await file.exists()) {
      return file.text();
    }
    const r = await generateFunction(description, inputs, output);
    Bun.write(file, r);
    return r;
  })();

  return (...args: Input) => {
    const toEval = `${result} \n main(${args.map(arg => JSON.stringify(arg)).join(", ")}); `
    console.log(toEval);
    return eval(toEval);
  };
}

const flatten = await geni("Flatten an array", [TwoArrays], S.Array(S.Number));

console.log(flatten({ fst: [1, 2, 3], snd: [4, 5, 6] }));

const dotproduct = await geni("Dot product two arrays", [TwoArrays], S.Array(S.Number));

console.log(dotproduct({ fst: [1, 2, 3], snd: [4, 5, 6] }));

const dotproductpair = await geni("Dot product two array pairs", [TwoArrays, TwoArrays], TwoArrays);

console.log(dotproductpair({ fst: [1, 2, 3], snd: [4, 5, 6] }, { fst: [7, 2, 3], snd: [10, 5, 6] }));