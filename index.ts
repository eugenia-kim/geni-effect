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

  return completion.choices[0].message.content;
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
  const result = await request(`Don't return other than the TypeScript function code.
   Make sure the function is called 'main'. 
   Generate a single function which does the following: ${description}`);
  console.log(result);
  return (input: Input) => 'eugenia' as Output;
}

const hello = await geni("Return a happy birthday message to the person mentioning the age.", Person, S.String);

const result = hello({ name: "hello", age: 13 });

console.log(result);



// const r = request(
//   `generate a function with the following schema: { description: "returns hello, name of the person", input: ${Person}, output: ${S.String} }`,
// );

// console.log(r);
