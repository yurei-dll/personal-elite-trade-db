import { cpSync, rmSync } from "node:fs";

rmSync("dist/dashboard/web", {
  force: true,
  recursive: true,
});

cpSync("src/dashboard/web", "dist/dashboard/web", {
  force: true,
  recursive: true,
});
