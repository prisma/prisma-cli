// Node's ESM resolver wording, buried one level down an error chain.
const wrap = (): never => {
  throw new Error("evaluation failed", {
    cause: new Error(
      "Cannot find package 'prisma/config' imported from /some/project/prisma.config.ts",
    ),
  });
};

export default wrap();
