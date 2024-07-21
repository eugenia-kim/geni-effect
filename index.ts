import { Effect, Either, Context, pipe, Option } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import { BunFileSystem } from "@effect/platform-bun";
import { type Schema, encodeSync } from "@effect/schema/Schema";
import OpenAI from "openai";
import { sha1 } from "js-sha1";
import _ from "lodash";
import type { PlatformError } from "@effect/platform/Error";
import { catchAll } from "effect/Effect";
import {
  validateCachedFunction,
  validate,
  validatePreviousAttempts,
  type PreviousAttempt,
} from "./validate";
import { LLM, type InputSchema } from "./types";
import { generate, toRunnable } from "./generate";

const RETRIES = 5;
const DIR = ".geni";
const TEMP_DIR = ".geni/temp";

export const provideChatGPT = Effect.provideService(LLM, {
  request: (prompt: string) =>
    Effect.gen(function* () {
      const openai = new OpenAI();

      const completion = yield* Effect.tryPromise(() =>
        openai.chat.completions.create({
          messages: [{ role: "system", content: prompt }],
          model: "gpt-4o",
        })
      );

      return completion.choices[0].message.content || "";
    }),
});

function getPreviousAttempts(hash: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const tempDir = `${TEMP_DIR}/${hash}`;
    const files: readonly string[] = yield* fs
      .readDirectory(tempDir)
      .pipe(catchAll((e) => Effect.succeed([] as const)));
    if (files.length === 0) {
      return 0;
    }
    const fileName = files[files.length - 1];
    const regex = /(\d+)\.ts/; // Match one or more digits (\d+) followed by ".ts"
    const match = fileName.match(regex);

    if (match) {
      const extractedNumber = match[1]; // The first capturing group contains the number
      return +extractedNumber + 1;
    }
    return 0;
  });
}

export const genericGeni = <Input extends unknown[], Output>(
  description: string,
  inputs: InputSchema<Input>,
  output: Schema<Output>,
  tests: Array<{
    input: Input;
    output: Output;
  }> = []
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const hash = sha1(`${description}:${inputs}:${output}`);
    const finalFile = `${DIR}/${hash}.ts`;
    const tempDir = `${TEMP_DIR}/${hash}`;
    yield* fs.makeDirectory(tempDir, { recursive: true });

    const previousAttempts: PreviousAttempt[] = yield* validatePreviousAttempts(
      tempDir,
      output,
      tests
    );
    const passingAttempt = previousAttempts.find((attempt) =>
      Option.isNone(attempt.verdict)
    );
    if (passingAttempt) {
      yield* fs.writeFileString(finalFile, passingAttempt.response);
      return toRunnable(passingAttempt.response, output);
    }

    const generateFunctionProgram = Effect.gen(function* () {
      const tempFileName = `${tempDir}/${previousAttempts.length}.ts`;
      const response = yield* generate(
        description,
        inputs,
        output,
        previousAttempts.map((attempt) => ({
          response: attempt.response,
          error: Option.getOrElse(attempt.verdict, () => ""),
        }))
      );
      yield* fs.writeFileString(tempFileName, response);

      const verdict = yield* validate(tempFileName, output, tests);
      previousAttempts.push({ response, verdict });
      if (Option.isSome(verdict)) {
        console.log(verdict.value);
        yield* Effect.fail(verdict.value);
      }
      return response;
    });

    let result = "";
    try {
      result = yield* Effect.retry(generateFunctionProgram, {
        times: RETRIES,
      });
    } catch (e) {
      throw new Error("Failed to generate function");
    }
    yield* fs.writeFileString(finalFile, result);
    return toRunnable(result, output);
  });

export const geni = <Input extends unknown[], Output>(
  description: string,
  inputs: InputSchema<Input>,
  output: Schema<Output>,
  tests: Array<{
    input: NoInfer<Input>;
    output: NoInfer<Output>;
  }>
) =>
  Effect.runPromise(
    pipe(
      genericGeni(description, inputs, output, tests),
      provideChatGPT,
      Effect.provide(BunFileSystem.layer),
      Effect.withSpan("geni")
    )
  );
