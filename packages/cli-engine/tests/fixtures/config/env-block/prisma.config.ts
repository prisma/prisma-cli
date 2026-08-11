import { defineConfig } from "@prisma/cli-engine";

export default defineConfig({
  toy: { greeting: "plain" },
  $env: { production: { toy: { greeting: "overlaid by $env" } } },
});
