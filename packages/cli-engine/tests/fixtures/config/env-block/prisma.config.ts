import { definePrismaConfig } from "@prisma/cli-engine";

export default definePrismaConfig({
  toy: { greeting: "plain" },
  $env: { production: { toy: { greeting: "overlaid by $env" } } },
});
