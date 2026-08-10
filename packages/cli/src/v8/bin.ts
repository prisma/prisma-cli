#!/usr/bin/env node
import process from "node:process";
import { runUpdateDiscoveryWorker } from "../update-check";
import { main } from "./main";

if (process.env.PRISMA_CLI_RUN_UPDATE_CHECK_WORKER === "1") {
  await runUpdateDiscoveryWorker();
  process.exitCode = 0;
} else {
  process.exitCode = await main(process);
}
