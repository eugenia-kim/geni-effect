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
  dataset: "training" | "evaluation",
) => {
  const program = Effect.gen(function* () {
    const task = yield* loadTask({ taskId, dataset });
    const description = `${userInstruction}
    The input is a grid of numbers, and the output is another grid of numbers represented in 2D arrays. Here are the list of {input, output} pair examples:
    ${JSON.stringify(task.train)}`;
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
    pipe(program, provideChatGPT, Effect.provide(BunFileSystem.layer)),
  );
};

const testing = await arcGeni(
  "Step 1: Identify the pattern of the colored points. Step 2: From the most bottom right blue point, start adding red (2) points from the position where the next blue (1) point would have been, continuing the same pattern. Step 3: Continue adding red points until the next point is out of bounds.",
  "0b17323b",
  "evaluation",
);

console.log(testing);