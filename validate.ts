import { Effect, Option } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import { type Schema } from "@effect/schema/Schema";
import * as ts from "typescript";
import { mapError } from "effect/Effect";
import _ from "lodash";
import { toTimeLimitedRunnable } from "./generate";
import type { PlatformError } from "@effect/platform/Error";

// type check and tests
export const validate = <Input extends unknown[], Output>(
  fileName: string,
  outputSchema: Schema<Output>,
  tests: Array<{
    input: Input;
    output: Output;
  }> = []
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const generatedCode = yield* fs.readFileString(fileName);
    const program = ts.createProgram([fileName], {});
    let emitResult = program.emit();
    let allDiagnostics = ts
      .getPreEmitDiagnostics(program)
      .concat(emitResult.diagnostics)
      .flatMap((diagnostic) => {
        if (diagnostic.file) {
          return diagnostic.file.fileName === fileName
            ? diagnostic.messageText
            : [];
        }
        return [];
      });
    if (allDiagnostics.length > 0) {
      return Option.some(
        `Type check failed: ${allDiagnostics
          .map((d) => ts.flattenDiagnosticMessageText(d, "\n"))
          .join("\n")}`
      );
    }

    const jsFileName = fileName.replace(".ts", ".js");
    ts.transpile(generatedCode, undefined, jsFileName);
    const runnable = toTimeLimitedRunnable(jsFileName, outputSchema, 3000);

    const failed = [];
    for (const test of tests) {
      console.log("Running test", fileName);
      try {
        const actual: Output = yield* Effect.promise(() =>
          runnable(...test.input)
        );
        if (!_.isEqual(test.output, actual)) {
          failed.push({ input: test.input, expected: test.output, actual });
        }
      } catch (e) {
        failed.push({ input: test.input, expected: test.output, actual: e });
      }
    }
    if (failed.length > 0) {
      return Option.some(
        `${failed.length}\/${
          tests.length
        } tests failed. Failed test cases: ${JSON.stringify(failed)}`
      );
    }
    return Option.none();
  });

export const validateCachedFunction = <Input extends unknown[], Output>(
  fileName: string,
  outputSchema: Schema<Output>,
  tests: Array<{
    input: Input;
    output: Output;
  }> = []
) =>
  validate(fileName, outputSchema, tests).pipe(
    mapError((e) => {
      if (typeof e === "string") {
        return (
          "Cached function is outdated. Need to regenerate one. See error: " + e
        );
      } else {
        return e;
      }
    })
  );

export interface PreviousAttempt {
  response: string;
  verdict: Option.Option<string>;
}

export const validatePreviousAttempts = <Input extends unknown[], Output>(
  directoryName: string,
  outputSchema: Schema<Output>,
  tests: Array<{
    input: Input;
    output: Output;
  }> = []
): Effect.Effect<PreviousAttempt[], PlatformError, FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const files = yield* fs.readDirectory(directoryName);
    // TODO: Maybe it can be done faster to find the passing one.
    return yield* Effect.all(
      files
        .filter((f) => f.includes(".ts"))
        .map((file) =>
          Effect.gen(function* () {
            const fileName = `${directoryName}/${file}`;
            const response = yield* fs.readFileString(fileName);
            const verdict = yield* validate(fileName, outputSchema, tests);
            yield* Effect.log("Validated ", fileName, verdict);
            return { response, verdict };
          })
        ),
      { concurrency: "unbounded" }
    );
  });
