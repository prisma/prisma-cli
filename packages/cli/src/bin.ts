#!/usr/bin/env node
import process from "node:process";

import { runCli } from "./cli";
import { runUpdateDiscoveryWorker } from "./shell/update-check";

if (process.env.PRISMA_CLI_RUN_UPDATE_CHECK_WORKER === "1") {
  runUpdateDiscoveryWorker().then(() => {
    process.exitCode = 0;
  });
} else {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
