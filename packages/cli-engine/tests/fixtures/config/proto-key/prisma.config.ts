import { definePrismaConfig } from "@prisma/cli-engine";

// A computed key is the only way to write __proto__ as an ordinary
// property. Copied to the loader's own object by assignment it would
// run Object.prototype's setter instead, and vanish.
// parent: false pins the chain to this file alone: these fixtures
// live inside a real repository, and a config file appearing in a
// directory above them must never join a test's chain.
export default definePrismaConfig({
  ["__proto__"]: { injected: true },
  toy: { greeting: "hello" },
  parent: false,
});
