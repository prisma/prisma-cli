import { definePrismaConfig } from "@prisma/cli-engine";

export default definePrismaConfig({
  root: "yes",
  toy: { greeting: "hello" },
});
