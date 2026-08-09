/**
 * The ./protocol subpath: the shapes that cross package and process
 * boundaries. Importing it drags no engine code.
 */
export {
  type CliErrorEnvelope,
  CliStructuredError,
  type Diagnostic,
  type NextAction,
  type NotOk,
  notOk,
  type Ok,
  ok,
  okVoid,
  type Result,
} from "../protocol";
