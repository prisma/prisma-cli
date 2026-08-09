#!/usr/bin/env node
import process from "node:process";

import {
  type Credentials,
  createCli,
  type InputStream,
  loadConfig,
  type Runtime,
} from "@prisma/cli-engine";
import { FileTokenStorage } from "../adapters/token-storage";
import { SERVICE_TOKEN_ENV_VAR } from "../lib/auth/client";
import { getCliVersion } from "../lib/version";
import { authWhoamiCommand } from "./auth/whoami";

const cli = createCli({
  name: "prisma-v8",
  version: getCliVersion(),
  products: [{ commands: { whoami: authWhoamiCommand } }],
  groups: {
    auth: { brief: "Manage local authentication for the CLI" },
  },
  commands: {
    "auth whoami": authWhoamiCommand,
  },
});

const controller = new AbortController();
let signalDelivered = false;

function onSignal(name: "SIGINT" | "SIGTERM"): void {
  if (signalDelivered) {
    process.exit(name === "SIGINT" ? 130 : 143);
  }
  signalDelivered = true;
  controller.abort(name);
}

process.on("SIGINT", () => onSignal("SIGINT"));
process.on("SIGTERM", () => onSignal("SIGTERM"));

function detectPackageManager(
  env: NodeJS.ProcessEnv,
): Runtime["packageManager"] {
  const userAgent = env.npm_config_user_agent ?? "";
  for (const name of ["pnpm", "yarn", "bun", "npm"] as const) {
    if (userAgent.startsWith(name)) {
      return name;
    }
  }
  return "unknown";
}

async function getCredentials(): Promise<Credentials | undefined> {
  const serviceToken = process.env[SERVICE_TOKEN_ENV_VAR]?.trim();
  if (serviceToken) {
    return { token: serviceToken };
  }

  const tokens = await new FileTokenStorage(
    process.env,
    controller.signal,
  ).getTokens();
  return tokens ? { token: tokens.accessToken } : undefined;
}

const stdin: InputStream = {
  setRawMode: process.stdin.isTTY
    ? (enabled) => {
        process.stdin.setRawMode(enabled);
      }
    : undefined,
  [Symbol.asyncIterator]: () =>
    process.stdin[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>,
};

const runtime: Runtime = {
  stdout: {
    write: (text) => {
      process.stdout.write(text);
    },
  },
  stderr: {
    write: (text) => {
      process.stderr.write(text);
    },
  },
  stdin,
  cwd: process.cwd(),
  env: process.env,
  isTty: {
    stdin: process.stdin.isTTY === true,
    stdout: process.stdout.isTTY === true,
    stderr: process.stderr.isTTY === true,
  },
  signal: controller.signal,
  config: await loadConfig(process.cwd()),
  getCredentials,
  packageManager: detectPackageManager(process.env),
};

process.exitCode = await cli.run(process.argv.slice(2), runtime);
