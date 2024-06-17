import { Struct, String, type Schema, Array, Number } from "@effect/schema/Schema";
import { geni } from "./index";

const TwoArrays = Struct({
    fst: Array(Number),
    snd: Array(Number),
});

const dotproductpair = await geni(
    "Dot product two array pairs",
    [TwoArrays, TwoArrays],
    TwoArrays,
);
console.log(
    dotproductpair(
        { fst: [1, 2, 3], snd: [4, 5, 6] },
        { fst: [7, 2, 3], snd: [10, 5, 6] },
    ),
);

const concat = await geni(
    "Append number to the string",
    [Number, String],
    String,
);
console.log(concat(13, "Hello"));

