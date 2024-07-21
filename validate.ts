import { Effect } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import { type Schema, encodeSync } from "@effect/schema/Schema";
import * as ts from "typescript";
import { mapError } from "effect/Effect";
import _ from "lodash";

function toRunnable<Input extends unknown[], Output>(
  generatedCode: string,
  output: Schema<Output>
) {
  return (...args: Input): Output => {
    const toEval = `${generatedCode} \n wrapper(${args
      .map((arg) => JSON.stringify(arg))
      .join(", ")}); `;
    return encodeSync(output)(eval(ts.transpile(toEval)));
  };
}

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
      yield* Effect.fail(
        `Type check failed: ${allDiagnostics
          .map((d) => ts.flattenDiagnosticMessageText(d, "\n"))
          .join("\n")}`
      );
    }

    const failed = [];
    const runnable = toRunnable(generatedCode, outputSchema);
    for (const test of tests) {
      const actual = runnable(...test.input);
      if (!_.isEqual(test.output, actual)) {
        failed.push({ input: test.input, expected: test.output, actual });
      }
    }
    if (failed.length > 0) {
      yield* Effect.fail(
        `${failed.length}\/${
          tests.length
        } tests failed. Failed test cases: ${JSON.stringify(failed)}`
      );
    }
    return generatedCode;
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
