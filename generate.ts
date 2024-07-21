import { Effect } from "effect";
import { generateFunctionPrompt, retryGenerateFunctionPrompt } from "./prompt";
import { LLM, type InputSchema } from "./types";
import type { Schema } from "@effect/schema";
import { encodeSync } from "@effect/schema/Schema";
import * as ts from "typescript";

const generateFunction = <Input, Output>(
  description: string,
  input: InputSchema<Input>,
  output: Schema.Schema<Output>,
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

export const generate = <Input extends unknown[], Output>(
  description: string,
  inputs: InputSchema<Input>,
  output: Schema.Schema<Output>,
  previousAttempts: Array<{
    response: string;
    error: string;
  }> = []
) =>
  Effect.gen(function* () {
    const func: string = yield* generateFunction(
      description,
      inputs,
      output,
      previousAttempts
    );
    const wrapperCode = `const wrapper: (${inputs
      .map((input, i) => `arg${i}: ${input}`)
      .join(", ")}) => ${output} = main;`;
    return `${func}\n${wrapperCode}`;
  });

export function toRunnable<Input extends unknown[], Output>(
  generatedCode: string,
  output: Schema.Schema<Output>
) {
  return (...args: Input): Output => {
    const toEval = `${generatedCode} \n wrapper(${args
      .map((arg) => JSON.stringify(arg))
      .join(", ")}); `;
    return encodeSync(output)(eval(ts.transpile(toEval)));
  };
}
