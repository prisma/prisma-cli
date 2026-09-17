import { definePrismaConfig } from "@prisma/cli-engine";

export default definePrismaConfig({
  toy: { greeting: "found in cwd" },
});
