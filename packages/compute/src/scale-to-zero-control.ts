import fs from "node:fs";

/**
 * Possible locations of the control file.
 *
 * The location of these files and the protocol are an internal implementation detail
 * subject to change. Only the high level TypeScript wrapper is a public API.
 */
const DEFAULT_CONTROL_FILE_PATHS: readonly string[] = [
  "/run/prisma/compute/keep-awake",
  "/uk/libukp/scale_to_zero_disable",
];

type ControlFileState =
  | { kind: "uninitialized"; paths: readonly string[] }
  | { kind: "unavailable"; paths: readonly string[] }
  | { kind: "open"; fd: number; path: string };

let controlFileState: ControlFileState = {
  kind: "uninitialized",
  paths: DEFAULT_CONTROL_FILE_PATHS,
};

export type ScaleToZeroSignal = "acquire" | "release";

export function writeScaleToZeroSignal(signal: ScaleToZeroSignal): boolean {
  const state = getControlFileState();

  if (state.kind !== "open") {
    return false;
  }

  try {
    fs.writeSync(state.fd, signal === "acquire" ? "+" : "-");
    return true;
  } catch {
    return false;
  }
}

function getControlFileState(): ControlFileState {
  if (controlFileState.kind !== "uninitialized") {
    return controlFileState;
  }

  const paths = controlFileState.paths;

  for (const path of paths) {
    try {
      controlFileState = {
        kind: "open",
        fd: fs.openSync(path, fs.constants.O_WRONLY),
        path,
      };
      return controlFileState;
    } catch {
      // Try the next candidate path.
    }
  }

  controlFileState = { kind: "unavailable", paths };
  return controlFileState;
}

export function configureScaleToZeroControlFileForTests(
  paths: string | readonly string[] | undefined,
): void {
  if (controlFileState.kind === "open") {
    fs.closeSync(controlFileState.fd);
  }

  let candidatePaths: readonly string[];
  if (paths === undefined) {
    candidatePaths = DEFAULT_CONTROL_FILE_PATHS;
  } else if (typeof paths === "string") {
    candidatePaths = [paths];
  } else {
    candidatePaths = paths;
  }

  controlFileState = { kind: "uninitialized", paths: candidatePaths };
}
