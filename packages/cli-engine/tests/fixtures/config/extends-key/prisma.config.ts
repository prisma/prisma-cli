import { defineConfig } from "@prisma/cli-engine";

// A string is the form c12 would act on if the loader left its merge
// directive enabled: it would read another file in and delete the key.
export default defineConfig({
  extends: "./base.config.ts",
  values: { list: [1, 2] },
});
