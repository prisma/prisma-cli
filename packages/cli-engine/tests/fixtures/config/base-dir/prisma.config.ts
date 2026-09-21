import { definePrismaConfig } from "@prisma/cli-engine";

// What a family's config helper does while the file runs: read the base
// directory the loader published and resolve against it.
const baseDir = (globalThis as { [key: symbol]: unknown })[
  Symbol.for("prisma.config.baseDir")
];

export default definePrismaConfig({
  toy: { greeting: "hello", baseDir },
});
