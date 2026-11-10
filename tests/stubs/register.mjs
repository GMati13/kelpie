// `node --import ./tests/stubs/register.mjs`: installs loader.mjs's hooks before any test loads.
import { register } from "node:module";

register("./loader.mjs", import.meta.url);
