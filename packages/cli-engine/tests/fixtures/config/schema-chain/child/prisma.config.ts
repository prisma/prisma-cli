import { definePrismaConfig } from "@prisma/cli-engine";

export default definePrismaConfig({
  toy: { out: "./dist", inputs: ["./a.prisma", "/abs/b.prisma"] },
});
