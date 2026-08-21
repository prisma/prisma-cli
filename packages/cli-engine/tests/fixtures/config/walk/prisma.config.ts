import { definePrismaConfig } from "@prisma/cli-engine";

export default definePrismaConfig({
  root: true,
  toy: { greeting: "top" },
});
