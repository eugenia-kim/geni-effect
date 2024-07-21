import {
  Struct,
  String,
  type Schema,
  Array,
  Number,
} from "@effect/schema/Schema";
import { geni } from "./index";
import { Effect } from "effect";
import { LLM } from "./types";

const provideMockLLM = Effect.provideService(LLM, {
  request: (prompt: string) =>
    Effect.gen(function* () {
      return `function main(people: ReadonlyArray<{ readonly name: string; readonly age: number }>): string {
        return people.map(person => \`Welcome \${person.name}, age \${person.age}!\`).join(' ');
    }`;
    }),
});

const TwoArrays = Struct({
  fst: Array(Number),
  snd: Array(Number),
});

const dotproductpair = await geni(
  "Dot product two array pairs",
  [TwoArrays, TwoArrays],
  TwoArrays,
  []
);
console.log(
  dotproductpair(
    { fst: [1, 2, 3], snd: [4, 5, 6] },
    { fst: [7, 2, 3], snd: [10, 5, 6] }
  )
);

const concat = await geni(
  "Append number to the string",
  [Number, String],
  String,
  []
);
console.log(concat(13, "Hello"));

const Person = Struct({
  name: String,
  age: Number,
});

const welcome = await geni(
  "Write a welcome message to people in the input array mentioning their names and ages",
  [Array(Person)],
  String,
  []
);

console.log(
  welcome([
    { name: "anton", age: 30 },
    { name: "geni", age: 28 },
  ])
);

const theOldest = await geni(
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
const o = theOldest([
  { name: "anton", age: 30 },
  { name: "geni", age: 28 },
]);
console.log(o);
