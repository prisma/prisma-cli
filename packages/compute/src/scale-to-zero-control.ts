import fs from "node:fs";

const DEFAULT_CONTROL_FILE_PATH = "/uk/libukp/scale_to_zero_disable";

type ControlFileState =
  | { kind: "uninitialized"; path: string }
  | { kind: "unavailable"; path: string }
  | { kind: "open"; fd: number; path: string };

let controlFileState: ControlFileState = {
  kind: "uninitialized",
  path: DEFAULT_CONTROL_FILE_PATH,
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

  try {
    controlFileState = {
      kind: "open",
      fd: fs.openSync(controlFileState.path, fs.constants.O_WRONLY),
      path: controlFileState.path,
    };
  } catch {
    controlFileState = { kind: "unavailable", path: controlFileState.path };
  }

  return controlFileState;
}

export function configureScaleToZeroControlFileForTests(
  path: string | undefined,
): void {
  if (controlFileState.kind === "open") {
    fs.closeSync(controlFileState.fd);
  }

  controlFileState = {
    kind: "uninitialized",
    path: path ?? DEFAULT_CONTROL_FILE_PATH,
  };
}
