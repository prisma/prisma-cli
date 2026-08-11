import { defineConfig } from "@prisma/cli-engine";

export default defineConfig({
  extends: { note: "c12 eats this before the loader sees it" },
  values: { list: [1, 2] },
});
