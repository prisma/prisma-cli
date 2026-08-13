import { definePrismaConfig } from "@prisma/cli-engine";

export default definePrismaConfig({
  toy: { greeting: "from the named file" },
});
