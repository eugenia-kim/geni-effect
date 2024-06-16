import { geni } from "./index";
import { Array, Number } from "@effect/schema/Schema";


const flatten = await geni("Flatten an array", Array(Array(Number)), Array(Number));

console.log(flatten([[1, 2, 3], [4, 5, 6]]));
