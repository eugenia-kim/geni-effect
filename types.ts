import type { Schema } from "@effect/schema";
import { Context, Effect } from "effect";

export type InputSchema<Input> = {
  [I in keyof Input]: Schema.Schema<Input[I]>;
};

export class LLM extends Context.Tag("LLM")<
  LLM,
  { readonly request: (prompt: string) => Effect.Effect<string, Error> }
>() {}
