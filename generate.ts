import { Effect, Either } from "effect";
import { generateFunctionPrompt, retryGenerateFunctionPrompt } from "./prompt";
import { LLM, type InputSchema } from "./types";
import type { Schema } from "@effect/schema";
import { encodeEither, encodeSync } from "@effect/schema/Schema";
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
    const workerCode = `
    onmessage = (e) => {
      postMessage({type: "log", content: "Started"});
      const res = wrapper(e.data[0] as any);
      postMessage({ type: "res", content: res });
    }
    `;
    return `${func}\n${wrapperCode}\n${workerCode}`;
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

export function toTimeLimitedRunnable<Input extends unknown[], Output>(
  fileName: string,
  output: Schema.Schema<Output>,
  timeout: number
) {
  if (!fileName.endsWith(".js")) {
    throw new Error("File must be a javascript file");
  }
  return (...args: Input): Promise<Output> => {
    return new Promise((resolve, reject) => {
      const worker = new Worker(fileName);
      console.log("started worker: ", fileName);
      worker.onmessage = (e) => {
        console.log("From worker", e.data);
        if (e.data.type === "log") {
        } else {
          const res = encodeEither(output)(e.data.content);
          if (Either.isLeft(res)) {
            return reject(new Error(res.left.message));
          }
          resolve(res.right);
        }
      };
      worker.postMessage(args);
      setTimeout(() => {
        worker.terminate();
        reject(new Error("Timeout"));
      }, timeout);
    });
  };
}
