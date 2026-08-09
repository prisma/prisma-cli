#!/usr/bin/env node
import process from "node:process";
import { main } from "./main";

process.exitCode = await main(process);
