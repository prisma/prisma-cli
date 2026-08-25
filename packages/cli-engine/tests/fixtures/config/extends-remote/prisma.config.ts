import { definePrismaConfig } from "@prisma/cli-engine";

// A dead local port: if the loader ever let c12 act on this key, the
// download would be attempted and would fail here rather than reach a
// real host.
// parent: false pins the chain to this file alone: these fixtures
// live inside a real repository, and a config file appearing in a
// directory above them must never join a test's chain.
export default definePrismaConfig({
  extends: "http://127.0.0.1:1/evil.tar.gz",
  values: { list: [1, 2] },
  parent: false,
});
