import { definePrismaConfig } from "@prisma/cli-engine";

// parent: false pins the chain to this file alone, so a config file
// appearing in one of this repository's directories above these
// fixtures can never join a test's chain.
export default definePrismaConfig({
  composer: { configPath: "./named-by-the-section.config.ts" },
  parent: false,
});
