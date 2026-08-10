#!/usr/bin/env node
import process from "node:process";

import { runCli } from "./cli";
import { runUpdateDiscoveryWorker } from "./update-check";

if (process.env.PRISMA_CLI_RUN_UPDATE_CHECK_WORKER === "1") {
  await runUpdateDiscoveryWorker();
  process.exitCode = 0;
} else {
  const controller = new AbortController();

  const abortCli = () => {
    if (!controller.signal.aborted) {
      controller.abort(new DOMException("Command canceled", "AbortError"));
    }
  };

  process.once("SIGINT", abortCli);
  process.once("SIGTERM", abortCli);

  try {
    process.exitCode = await runCli({ signal: controller.signal });
  } finally {
    process.off("SIGINT", abortCli);
    process.off("SIGTERM", abortCli);
  }
}
