import { readFileSync } from "node:fs";

export const HTMX_SCRIPT = readFileSync(
  require.resolve("htmx.org/dist/htmx.min.js"),
  "utf8",
);
