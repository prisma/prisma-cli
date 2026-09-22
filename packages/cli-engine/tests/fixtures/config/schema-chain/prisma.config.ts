import { definePrismaConfig } from "@prisma/cli-engine";

export default definePrismaConfig({
  toy: { dir: "./migrations", greeting: "from the parent" },
});
