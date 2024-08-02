import { createClient } from "@supabase/supabase-js";
import { loadTask, type Example, type Task } from "./arcAgiDataLoader";
import { Effect, pipe } from "effect";
import { BunFileSystem } from "@effect/platform-bun";

const supabaseUrl = "https://cawmpecwdifxnziewawf.supabase.co";
const supabaseKey = process.env.SUPABASE_KEY ?? "";
const supabase = createClient(supabaseUrl, supabaseKey);

export const populateTask = (
  taskId: string,
  dataset: "training" | "evaluation"
) =>
  Effect.runPromise(
    pipe(
      Effect.gen(function* () {
        const trainingTask = yield* loadTask({ taskId, dataset });
        const table = supabase.from("examples");
        const addExample =
          (isTest: boolean) => (example: Example, id: number) =>
            Effect.promise(async () => {
              console.log("adding example", id);
              const r = await table.insert({
                task_id: `${dataset}/${taskId}`,
                id,
                input: example.input,
                output: example.output,
                is_test: isTest,
              });
              console.log(r.error);
              return r;
            });
        yield* Effect.all(trainingTask.train.map(addExample(false)));
        yield* Effect.all(trainingTask.test.map(addExample(true)));
      }),
      Effect.provide(BunFileSystem.layer)
    )
  );

await populateTask("0a938d79", "training");
// await populateTask("0a938d79", "evaluation");
