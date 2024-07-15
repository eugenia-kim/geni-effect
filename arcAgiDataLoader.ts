import { BunFileSystem } from "@effect/platform-bun";
import type { PlatformError } from "@effect/platform/Error";
import { FileSystem } from "@effect/platform/FileSystem";
import { Effect, pipe } from "effect";

interface Task {
  train: Array<{
    input: Array<Array<number>>;
    output: Array<Array<number>>;
  }>;
  test: Array<{
    input: Array<Array<number>>;
    output: Array<Array<number>>;
  }>;
}

export const loadTask = ({
  taskId,
  dataset,
}: {
  taskId: string;
  dataset: "training" | "evaluation";
}): Effect.Effect<Task, PlatformError, FileSystem> => {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const data = yield* fs.readFileString(
      `ARC-AGI/data/${dataset}/${taskId}.json`
    );
    return JSON.parse(data);
  });
};

console.log(
  await Effect.runPromise(
    pipe(
      loadTask({ taskId: "0a938d79", dataset: "training" }),
      Effect.provide(BunFileSystem.layer)
    )
  )
);
