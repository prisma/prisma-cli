import { definePrismaConfig } from "@prisma/cli-engine";

export default definePrismaConfig({
  toy: { greeting: "hello" },
  other: { level: 2 },
});
