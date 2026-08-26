import { definePrismaConfig } from "@prisma/cli-engine";

// A string is the form c12 would act on if the loader left its merge
// directive enabled: it would read another file in and delete the key.
// parent: false pins the chain to this file alone: these fixtures
// live inside a real repository, and a config file appearing in a
// directory above them must never join a test's chain.
export default definePrismaConfig({
  extends: "./base.config.ts",
  values: { list: [1, 2] },
  parent: false,
});
