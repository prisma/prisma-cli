// A missing package whose name merely starts with "prisma" — the
// closing quote in the matched text must keep this on the generic path.
const explode = (): never => {
  throw new Error(
    "Cannot find package 'prisma-toolbelt' imported from /some/project/prisma.config.ts",
  );
};

export default explode();
