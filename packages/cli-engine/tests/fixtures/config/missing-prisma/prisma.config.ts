// What evaluating init's scaffold produces in a project without the
// prisma package: jiti's wording, thrown as the evaluation error. A
// real `import "prisma/config"` cannot stand in for it here — this
// repository's own dependency tree resolves a prisma package.
const explode = (): never => {
  throw new Error("Cannot find module 'prisma/config'");
};

export default explode();
