import { defineConfig } from "@prisma/cli-engine";

export default defineConfig({
  toy: { greeting: "hello" },
  other: { level: 2 },
});
