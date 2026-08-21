import { definePrismaConfig } from "@prisma/cli-engine";

export default definePrismaConfig({
  root: false,
  toy: { greeting: "unrooted" },
});
