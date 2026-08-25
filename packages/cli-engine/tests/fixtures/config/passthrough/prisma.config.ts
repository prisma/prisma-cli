import { definePrismaConfig } from "@prisma/cli-engine";

// parent: false pins the chain to this file alone: these fixtures
// live inside a real repository, and a config file appearing in a
// directory above them must never join a test's chain.
export default definePrismaConfig({
  values: { list: [1, 2], when: new Date(0) },
  parent: false,
});
