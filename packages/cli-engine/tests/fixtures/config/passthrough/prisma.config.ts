import { defineConfig } from "@prisma/cli-engine";

export default defineConfig({
  values: { list: [1, 2], when: new Date(0) },
});
