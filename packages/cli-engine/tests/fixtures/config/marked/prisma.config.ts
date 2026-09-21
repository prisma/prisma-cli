import { definePrismaConfig } from "@prisma/cli-engine";

// parent: false pins the chain to this file alone: these fixtures
// live inside a real repository, and a config file appearing in a
// directory above them must never join a test's chain.
export default definePrismaConfig({
  toy: { greeting: "hello" },
  other: { level: 2 },
  parent: false,
});
