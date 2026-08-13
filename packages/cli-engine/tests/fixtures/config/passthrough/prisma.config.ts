import { definePrismaConfig } from "@prisma/cli-engine";

export default definePrismaConfig({
  values: { list: [1, 2], when: new Date(0) },
});
