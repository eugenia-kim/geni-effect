import { Schema } from "@effect/schema";
import { Effect, pipe } from "effect";
import { genericGeni, provideChatGPT } from ".";
import { loadTask } from "./arcAgiDataLoader";
import { BunFileSystem } from "@effect/platform-bun";

// inteface ArcTaskId = Schema.Struct({
//   taskId: Schema.String,
//   dataset: Schema.String
// });

const Grid = Schema.Array(Schema.Array(Schema.Number));

// arcGeni will solve the Arc AGI task by generating a function that matches the description.
const arcGeni = (
  userInstruction: string,
  taskId: string,
  dataset: "training" | "evaluation"
) => {
  const program = Effect.gen(function* () {
    const task = yield* loadTask({ taskId, dataset });
    const description = `${userInstruction}
    The input is a grid of numbers, and the output is another grid of numbers. Here are the input/output pair examples:
    ${task.train}`;
    console.log("Calling with description: ", description);
    const fun = yield* genericGeni(description, [Grid], Grid);
    for (const test of task.test) {
      const result = fun(test.input);
      if (JSON.stringify(result) !== JSON.stringify(test.output)) {
        throw new Error(`Expected ${test.output} but got ${result}`);
      }
    }
    return fun;
  });

  return Effect.runPromise(
    pipe(program, provideChatGPT, Effect.provide(BunFileSystem.layer))
  );
};

arcGeni(
  "continue the pattern with red dots to bottom right corner",
  "0b17323b",
  "training"
);
