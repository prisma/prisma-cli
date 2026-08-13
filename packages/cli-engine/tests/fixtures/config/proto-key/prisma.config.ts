import { definePrismaConfig } from "@prisma/cli-engine";

// A computed key is the only way to write __proto__ as an ordinary
// property. Copied to the loader's own object by assignment it would
// run Object.prototype's setter instead, and vanish.
export default definePrismaConfig({
  ["__proto__"]: { injected: true },
  toy: { greeting: "hello" },
});
