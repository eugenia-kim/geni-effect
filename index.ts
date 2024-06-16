import { Effect, Console } from "effect";
import * as S from "@effect/schema/Schema";
import { JSONSchema } from "@effect/schema";
import OpenAI from "openai";

// Plan
// [done] 1. First function with proper typing
// 2. Call open AI to generate a function
// 3. Simple cache of function on disk

const openai = new OpenAI();

async function request(prompt: string) {
  const completion = await openai.chat.completions.create({
    messages: [{ role: "system", content: prompt }],
    model: "gpt-4o",
  });

  return completion.choices[0].message.content || "";
}

const Person = S.Struct({
  name: S.String,
  age: S.Number,
});

type PersonType = S.Schema.Type<typeof Person>;

async function geni<Input, Output>(
  description: string,
  input: S.Schema<Input>,
  output: S.Schema<Output>
): Promise<(input: Input) => Output> {
  const result = await request(`
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
  return (args: Input) => {
    const toEval = `${result} \n main(${JSON.stringify(args)}); `
    console.log(toEval);
    return eval(toEval);
  };
}

const hello = await geni("Flatten an array", S.Array(S.Array(S.Number)), S.Array(S.Number));

// const result = hello({ name: "hello", age: 13 });

console.log(hello([[1, 2, 3], [4, 5, 6]]));



// const r = request(
//   `generate a function with the following schema: { description: "returns hello, name of the person", input: ${ Person }, output: ${ S.String } } `,
// );

// console.log(r);
