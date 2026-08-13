import { definePrismaConfig } from "@prisma/cli-engine";

export default definePrismaConfig({
  toy: { greeting: "plain" },
  $production: { toy: { greeting: "overlaid by $production" } },
});
