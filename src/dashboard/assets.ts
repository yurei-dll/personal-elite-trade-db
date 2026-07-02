import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const DASHBOARD_WEB_DIRECTORY = resolve(__dirname, "web");

export function readDashboardWebAsset(fileName: string): string {
  return readFileSync(join(DASHBOARD_WEB_DIRECTORY, fileName), "utf8");
}

export function readDashboardWebBinaryAsset(fileName: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(join(DASHBOARD_WEB_DIRECTORY, fileName)));
}

export const HTMX_SCRIPT = readFileSync(
  require.resolve("htmx.org/dist/htmx.min.js"),
  "utf8",
);

export const THREE_MODULE_SCRIPT = readFileSync(
  join(dirname(require.resolve("three")), "three.module.js"),
  "utf8",
);

export const THREE_CORE_SCRIPT = readFileSync(
  join(dirname(require.resolve("three")), "three.core.js"),
  "utf8",
);
