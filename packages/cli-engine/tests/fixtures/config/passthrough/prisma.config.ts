import { defineConfig } from "@prisma/cli-engine";

export default defineConfig({
  extends: { note: "a top-level key named extends is just a section" },
  values: { list: [1, 2], when: new Date(0) },
});
