import { Effect } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import { generateFunctionPrompt, retryGenerateFunctionPrompt } from "./prompt";
import { LLM, type InputSchema } from "./types";
import type { Schema } from "@effect/schema";

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
