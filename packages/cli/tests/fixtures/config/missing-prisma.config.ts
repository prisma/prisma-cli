// Node's package-level wording for a missing `import "prisma/config"`,
// thrown because this repository's own tree resolves a prisma package.
const explode = (): never => {
  throw new Error(
    "Cannot find package 'prisma' imported from /some/project/prisma.config.ts",
  );
};

export default explode();
