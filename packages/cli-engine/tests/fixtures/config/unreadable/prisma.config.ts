const explode = (): never => {
  throw new Error("boom at config evaluation time");
};

export default explode();
