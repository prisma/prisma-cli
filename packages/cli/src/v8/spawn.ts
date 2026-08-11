import { spawn } from "node:child_process";
import type { SpawnChild } from "@prisma/cli-engine";

/**
 * The engine's spawn seam, adapted to node:child_process. Inherited
 * stdio, no `detached`, no new console: the child stays in this
 * process's group (POSIX) or console (Windows), so the terminal
 * delivers Ctrl-C to it natively.
 */
export const spawnChild: SpawnChild = (request) => {
  const child = spawn(request.command, [...request.args], {
    cwd: request.cwd,
    env: request.env,
    stdio: "inherit",
  });
  return {
    ended: new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (exitCode, signal) => {
        resolve({ exitCode, signal });
      });
    }),
    kill: (signal) => {
      child.kill(signal);
    },
  };
};
