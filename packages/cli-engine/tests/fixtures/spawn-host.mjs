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
  writeFileSync(join(dir, "child-pid"), String(child.pid));
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
  // Idles forever: the test controls when it ends (the engine's
  // second-press SIGTERM escalation), so nothing races a timer.
  "double-sigint": ["idle", join(dir, "ready")],
  // Idles forever, and the handler walks away from it: only the engine
  // ending the child can stop this process leaving an orphan behind.
  "abandon-child": ["idle", join(dir, "ready")],
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
    if (scenario === "abandon-child") {
      live.catch(() => {});
      return ok(ctx.present({ data: null }, { human: () => [] }));
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
    // The marker is written AFTER the engine has handled the press, so
    // the test can gate the next signal on the previous one landing
    // instead of sleeping.
    let delivered = 0;
    const deliver = (signal) => {
      subscriber(signal);
      delivered += 1;
      writeFileSync(join(dir, `signal-${delivered}`), signal);
    };
    const onSigint = () => deliver("SIGINT");
    const onSigterm = () => deliver("SIGTERM");
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    return () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    };
  },
  loadConfig: async () => ({
    path: "prisma.config.ts",
    sections: {},
    diagnostics: [],
  }),
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
// Not process.exit: stdout and stderr are pipes under the real-child
// tests, and it would truncate writes still queued on them — including
// the commentary the engine flushes as the run settles. The engine has
// already unsubscribed its signal handlers, so the loop drains.
process.exitCode = await cli.run(["go"], runtime);
