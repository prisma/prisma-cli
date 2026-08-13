import { definePrismaConfig } from "@prisma/cli-engine";

// A dead local port: if the loader ever let c12 act on this key, the
// download would be attempted and would fail here rather than reach a
// real host.
export default definePrismaConfig({
  extends: "http://127.0.0.1:1/evil.tar.gz",
  values: { list: [1, 2] },
});
