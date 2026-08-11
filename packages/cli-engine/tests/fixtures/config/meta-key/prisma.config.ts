import { defineConfig } from "@prisma/cli-engine";

// $meta is the one top-level key that can never be reported as an
// unknown section: c12 deletes it from the config object before the
// loader is handed it.
export default defineConfig({
  $meta: { note: "c12 takes this for layer metadata" },
  toy: { greeting: "hello" },
});
