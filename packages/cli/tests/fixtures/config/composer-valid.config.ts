import { definePrismaConfig } from "@prisma/cli-engine";
import { defineConfig as composer } from "@prisma/composer/config";
import { nodeBuild } from "@prisma/composer/node/control";

const build = nodeBuild();

export default definePrismaConfig({
  composer: composer({
    extensions: [build],
    state: {
      extension: build.id,
      create: () => {
        throw new Error("no command in these tests reaches the state store");
      },
    },
  }),
  parent: false,
});
