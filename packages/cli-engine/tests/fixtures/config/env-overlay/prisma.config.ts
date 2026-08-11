import { defineConfig } from "@prisma/cli-engine";

export default defineConfig({
  toy: { greeting: "plain" },
  $production: { toy: { greeting: "overlaid by $production" } },
});
