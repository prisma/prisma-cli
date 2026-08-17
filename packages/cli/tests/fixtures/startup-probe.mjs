// Runs the bin body in a process of its own and reports what the run
// left behind: which of composer's constellation modules were evaluated,
// and how many signal listeners are still attached. A module loader hook
// records every evaluated module, so the answer covers the whole graph
// rather than the specifiers this file can see.
import { writeFileSync } from "node:fs";
import { registerHooks } from "node:module";

const [scenario, reportPath] = process.argv.slice(2);

const evaluated = [];
registerHooks({
  load(url, context, nextLoad) {
    evaluated.push(url);
    return nextLoad(url, context);
  },
});

const CONSTELLATION = /\/node_modules\/(\.pnpm\/)?(@?alchemy|@?effect)[.@/]/;
const UP_TO_NODE_MODULES = /^.*\/node_modules\//;

process.argv = [process.argv[0], "prisma-cli", "--version"];
const { main } = await import("../../src/main.ts");
const exitCode = await main(process);

// The detector's own canary: this import is what a composer command
// reaches through its dynamic executor boundary, and it must show up.
if (scenario === "canary") {
  await import("@prisma/composer/deploy");
}

writeFileSync(
  reportPath,
  JSON.stringify({
    exitCode,
    familyEvaluated: evaluated.some((url) =>
      url.includes("@prisma/composer-cli/dist/family.mjs"),
    ),
    constellation: evaluated
      .filter((url) => CONSTELLATION.test(url))
      .map((url) => url.replace(UP_TO_NODE_MODULES, "")),
    signalListeners: {
      SIGINT: process.listenerCount("SIGINT"),
      SIGTERM: process.listenerCount("SIGTERM"),
    },
  }),
);
