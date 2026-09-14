// An evaluation error whose cause chain loops back on itself; the
// loader's chain walk must terminate rather than hang.
const explode = (): never => {
  const error = new Error("cyclic evaluation failure");
  error.cause = error;
  throw error;
};

export default explode();
