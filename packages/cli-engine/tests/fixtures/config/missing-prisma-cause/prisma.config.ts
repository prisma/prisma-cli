// Node's ESM resolver wording — package-level, no subpath — buried one
// level down an error chain.
const wrap = (): never => {
  throw new Error("evaluation failed", {
    cause: new Error(
      "Cannot find package 'prisma' imported from /some/project/prisma.config.ts",
    ),
  });
};

export default wrap();
