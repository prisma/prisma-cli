// A real engine host run as a subprocess by the real-child spawn tests:
// scenarios that need true inherited stdio or real process-group signal
// delivery, which an in-process harness cannot observe.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCli,
  defineCommand,
  exitWithChildStatus,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";

const [scenario, dir] = process.argv.slice(2);
const childScript = fileURLToPath(new URL("./child.mjs", import.meta.url));

const spawnChild = (request) => {
  const child = spawn(request.command, [...request.args], {
    cwd: request.cwd,
    env: request.env,
    stdio: "inherit",
  });
  return {
    ended: new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (exitCode, signal) => resolve({ exitCode, signal }));
    }),
    kill: (signal) => {
      child.kill(signal);
    },
  };
};

const childArgs = {
  "unframed-stdout": ["print"],
  "native-sigint": ["idle", join(dir, "ready")],
  "double-sigint": ["ready-then-exit", join(dir, "ready")],
}[scenario];

const command = defineCommand({
  help: { summary: "spawn-host scenario" },
  maySpawn: true,
  handler: async (_args, ctx) => {
    const live = ctx.spawn({
      command: process.execPath,
      args: [childScript, ...childArgs],
    });
    if (scenario === "unframed-stdout") {
      ctx.report({ kind: "message", severity: "info", text: "during-child" });
    }
    const child = await live;
    writeFileSync(
      join(dir, "result.json"),
      JSON.stringify({
        exitCode: child.exitCode,
        signal: child.signal,
        aborted: ctx.signal.aborted,
      }),
    );
    return ok(exitWithChildStatus(child));
  },
});

const runtime = {
  stdout: { write: (text) => process.stdout.write(text) },
  stderr: { write: (text) => process.stderr.write(text) },
  stdin: {
    async *[Symbol.asyncIterator]() {},
  },
  cwd: process.cwd(),
  env: process.env,
  isTty: { stdin: false, stdout: false, stderr: false },
  exit: (code) => process.exit(code),
  onSignal: (subscriber) => {
    const onSigint = () => subscriber("SIGINT");
    const onSigterm = () => subscriber("SIGTERM");
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    return () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    };
  },
  config: { sections: {}, diagnostics: [] },
  managementApi: { baseUrl: "https://test.invalid" },
  packageManager: "unknown",
  spawn: spawnChild,
};

const cli = createCli({
  name: "spawn-host",
  version: "0.0.0",
  commandFamilies: [],
  groups: {},
  commands: { go: command },
});

writeFileSync(join(dir, "host-ready"), "ready");
const exitCode = await cli.run(["go"], runtime);
process.exit(exitCode);
