#!/usr/bin/env node
import process from "node:process";

import { runCli } from "./cli";

runCli().then((exitCode) => {
  process.exitCode = exitCode;
});
