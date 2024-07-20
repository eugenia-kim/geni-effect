import { BunFileSystem } from "@effect/platform-bun";
import type { PlatformError } from "@effect/platform/Error";
import { FileSystem } from "@effect/platform/FileSystem";
import { Effect, pipe } from "effect";
import { Schema } from "@effect/schema";

export const Grid = Schema.Array(Schema.Array(Schema.Number));

const ArcData = Schema.Array(
  Schema.Struct({
    input: Grid,
    output: Grid,
  }),
);

const Task = Schema.Struct({
  train: ArcData,
  test: ArcData,
});

export const loadTask = ({
  taskId,
  dataset,
}: {
  taskId: string;
  dataset: "training" | "evaluation";
}): Effect.Effect<typeof Task.Type, PlatformError, FileSystem> => {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const data = yield* fs.readFileString(
      `ARC-AGI/data/${dataset}/${taskId}.json`,
    );
    return Schema.decodeSync(Task)(JSON.parse(data));
  });
};

// console.log(
//   await Effect.runPromise(
//     pipe(
//       loadTask({ taskId: "0a938d79", dataset: "training" }),
//       Effect.provide(BunFileSystem.layer)
//     )
//   )
// );
