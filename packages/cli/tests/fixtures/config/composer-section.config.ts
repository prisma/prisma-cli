import { definePrismaConfig } from "@prisma/cli-engine";

export default definePrismaConfig({
  composer: { configPath: "./named-by-the-section.config.ts" },
});
