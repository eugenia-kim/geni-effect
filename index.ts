import { Effect, Console } from "effect";
import * as S from "@effect/schema/Schema";
import { JSONSchema } from "@effect/schema";

// Plan
// [done] 1. First function with proper typing
// 2. Call open AI to generate a function
// 3. Simple cache of function on disk

const Person = S.Struct({
  name: S.String,
  age: S.Number,
});

type PersonType = S.Schema.Type<typeof Person>;

const person = { name: "hello", age: 13 };

const program = Console.log("Hello, World!");
Effect.runSync(program);

function geni<Input, Output>(
  description: string,
  input: S.Schema<Input>,
  output: S.Schema<Output>
): (input: Input) => Output {
  return (input: Input) => "world" as Output;
}

const hello = geni("hello", Person, S.String);

const result = hello(person);

console.log(result);
