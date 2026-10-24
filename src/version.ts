import { readFileSync } from "node:fs";

// Resolves to the package root from both src/ (tests) and dist/ (published build).
const packageJsonUrl = new URL("../package.json", import.meta.url);

export const VERSION: string = (
  JSON.parse(readFileSync(packageJsonUrl, "utf8")) as { version: string }
).version;
