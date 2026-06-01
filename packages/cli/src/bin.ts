#!/usr/bin/env node
import process from "node:process";

import { runCli } from "./cli";

const controller = new AbortController();

const abortCli = () => {
  if (!controller.signal.aborted) {
    controller.abort(new DOMException("Command canceled", "AbortError"));
  }
};

process.once("SIGINT", abortCli);
process.once("SIGTERM", abortCli);

runCli({ signal: controller.signal }).then((exitCode) => {
  process.exitCode = exitCode;
}).finally(() => {
  process.off("SIGINT", abortCli);
  process.off("SIGTERM", abortCli);
});
