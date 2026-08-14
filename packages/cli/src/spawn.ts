import { spawn } from "node:child_process";
import type { OutputStream, SpawnChild } from "@prisma/cli-engine";

/**
 * The engine's spawn seam, adapted to node:child_process. Human mode
 * inherits stdio; structured mode pipes both child output streams to
 * diagnostics. Neither mode detaches or opens a new console, so the child
 * stays in this process's group (POSIX) or console (Windows).
 */
export function makeSpawnChild(diagnostics: OutputStream): SpawnChild {
  return (request) => {
    const structured = request.output === "diagnostic";
    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: request.env,
      stdio: structured ? ["inherit", "pipe", "pipe"] : "inherit",
    });
    if (structured) {
      child.stdout?.on("data", (chunk: Buffer) => {
        diagnostics.write(chunk.toString("utf8"));
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        diagnostics.write(chunk.toString("utf8"));
      });
    }
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
}
