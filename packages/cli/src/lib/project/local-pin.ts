// biome-ignore-all lint/performance/useTopLevelRegex: Existing local state text parsing regexes are kept inline for readability.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { Result, TaggedError, UnhandledException } from "better-result";

export const LOCAL_RESOLUTION_PIN_RELATIVE_PATH = ".prisma/local.json";

export interface LocalResolutionPin {
  workspaceId: string;
  projectId: string;
}

export type LocalResolutionPinReadResult =
  | { kind: "missing" }
  | { kind: "present"; pin: LocalResolutionPin };

export class LocalResolutionPinInvalidJsonError extends TaggedError(
  "LocalResolutionPinInvalidJsonError",
)<{
  message: string;
  cause: unknown;
  pinPath: string;
}>() {
  constructor(cause: unknown) {
    super({
      message: `${LOCAL_RESOLUTION_PIN_RELATIVE_PATH} contains invalid JSON.`,
      cause,
      pinPath: LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
    });
  }
}

export class LocalResolutionPinInvalidShapeError extends TaggedError(
  "LocalResolutionPinInvalidShapeError",
)<{
  message: string;
  pinPath: string;
}>() {
  constructor() {
    super({
      message: `${LOCAL_RESOLUTION_PIN_RELATIVE_PATH} must contain workspaceId and projectId string fields only.`,
      pinPath: LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
    });
  }
}

export class LocalResolutionPinReadAbortedError extends TaggedError(
  "LocalResolutionPinReadAbortedError",
)<{
  message: string;
  cause: unknown;
  pinPath: string;
}>() {
  constructor(cause: unknown) {
    super({
      message: `Reading ${LOCAL_RESOLUTION_PIN_RELATIVE_PATH} was aborted.`,
      cause,
      pinPath: LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
    });
  }
}

export type LocalResolutionPinReadError =
  | LocalResolutionPinInvalidJsonError
  | LocalResolutionPinInvalidShapeError
  | LocalResolutionPinReadAbortedError
  | UnhandledException;

export class LocalResolutionPinSerializationError extends TaggedError(
  "LocalResolutionPinSerializationError",
)<{
  message: string;
  cause: unknown;
  pinPath: string;
}>() {
  constructor(cause: unknown) {
    super({
      message: `Could not serialize ${LOCAL_RESOLUTION_PIN_RELATIVE_PATH}.`,
      cause,
      pinPath: LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
    });
  }
}

export class LocalResolutionPinWriteAbortedError extends TaggedError(
  "LocalResolutionPinWriteAbortedError",
)<{
  message: string;
  cause: unknown;
  pinPath: string;
}>() {
  constructor(cause: unknown) {
    super({
      message: `Writing ${LOCAL_RESOLUTION_PIN_RELATIVE_PATH} was aborted.`,
      cause,
      pinPath: LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
    });
  }
}

export class LocalResolutionPinWriteFailedError extends TaggedError(
  "LocalResolutionPinWriteFailedError",
)<{
  message: string;
  cause: unknown;
  operation: "create-directory" | "write-temp-file" | "rename-temp-file";
  pinPath: string;
}>() {
  constructor(
    operation: "create-directory" | "write-temp-file" | "rename-temp-file",
    cause: unknown,
  ) {
    super({
      message: `Could not write ${LOCAL_RESOLUTION_PIN_RELATIVE_PATH}.`,
      cause,
      operation,
      pinPath: LOCAL_RESOLUTION_PIN_RELATIVE_PATH,
    });
  }
}

export type LocalResolutionPinWriteError =
  | LocalResolutionPinSerializationError
  | LocalResolutionPinWriteAbortedError
  | LocalResolutionPinWriteFailedError;

export class LocalResolutionPinGitignoreUpdateAbortedError extends TaggedError(
  "LocalResolutionPinGitignoreUpdateAbortedError",
)<{
  message: string;
  cause: unknown;
  gitignorePath: string;
}>() {
  constructor(cause: unknown) {
    super({
      message: "Updating .gitignore for the local Project binding was aborted.",
      cause,
      gitignorePath: ".gitignore",
    });
  }
}

export class LocalResolutionPinGitignoreUpdateFailedError extends TaggedError(
  "LocalResolutionPinGitignoreUpdateFailedError",
)<{
  message: string;
  cause: unknown;
  operation: "read" | "write";
  gitignorePath: string;
}>() {
  constructor(operation: "read" | "write", cause: unknown) {
    super({
      message: "Could not update .gitignore for the local Project binding.",
      cause,
      operation,
      gitignorePath: ".gitignore",
    });
  }
}

export type LocalResolutionPinGitignoreUpdateError =
  | LocalResolutionPinGitignoreUpdateAbortedError
  | LocalResolutionPinGitignoreUpdateFailedError;

export async function readLocalResolutionPin(
  cwd: string,
  signal?: AbortSignal,
): Promise<Result<LocalResolutionPinReadResult, LocalResolutionPinReadError>> {
  return Result.gen(async function* () {
    yield* ensureLocalResolutionPinReadNotAborted(signal);

    const file = yield* Result.await(readLocalResolutionPinFile(cwd, signal));
    if (file.kind === "missing") {
      return Result.ok({
        kind: "missing",
      } satisfies LocalResolutionPinReadResult);
    }

    const parsed = yield* parseLocalResolutionPin(file.raw);
    if (!isLocalResolutionPin(parsed)) {
      return Result.err(new LocalResolutionPinInvalidShapeError());
    }

    return Result.ok({
      kind: "present",
      pin: parsed,
    } satisfies LocalResolutionPinReadResult);
  });
}

function ensureLocalResolutionPinReadNotAborted(
  signal: AbortSignal | undefined,
): Result<void, LocalResolutionPinReadAbortedError> {
  return Result.try({
    try: () => signal?.throwIfAborted(),
    catch: (cause) => new LocalResolutionPinReadAbortedError(cause),
  });
}

type LocalResolutionPinFileReadResult =
  | { kind: "missing" }
  | { kind: "present"; raw: string };

async function readLocalResolutionPinFile(
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<
  Result<
    LocalResolutionPinFileReadResult,
    LocalResolutionPinReadAbortedError | UnhandledException
  >
> {
  const readResult = await Result.tryPromise({
    try: () =>
      readFile(path.join(cwd, LOCAL_RESOLUTION_PIN_RELATIVE_PATH), {
        encoding: "utf8",
        signal,
      }),
    catch: (cause) =>
      signal?.aborted
        ? new LocalResolutionPinReadAbortedError(cause)
        : new UnhandledException({ cause }),
  });
  if (readResult.isErr()) {
    if (
      readResult.error instanceof UnhandledException &&
      (readResult.error.cause as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return Result.ok({ kind: "missing" });
    }
    return Result.err(readResult.error);
  }

  return Result.ok({ kind: "present", raw: readResult.value });
}

function parseLocalResolutionPin(
  raw: string,
): Result<unknown, LocalResolutionPinInvalidJsonError | UnhandledException> {
  return Result.try({
    try: () => JSON.parse(raw) as unknown,
    catch: (cause) =>
      cause instanceof SyntaxError
        ? new LocalResolutionPinInvalidJsonError(cause)
        : new UnhandledException({ cause }),
  });
}

export async function writeLocalResolutionPin(
  cwd: string,
  pin: LocalResolutionPin,
  signal?: AbortSignal,
): Promise<Result<void, LocalResolutionPinWriteError>> {
  return Result.gen(async function* () {
    const prismaDir = path.join(cwd, ".prisma");
    yield* ensureLocalResolutionPinWriteNotAborted(signal);
    // mkdir does not accept AbortSignal; check before the filesystem boundary.
    yield* Result.await(
      writeLocalResolutionPinBoundary(
        () => mkdir(prismaDir, { recursive: true }),
        "create-directory",
        signal,
      ),
    );
    const pinPath = path.join(cwd, LOCAL_RESOLUTION_PIN_RELATIVE_PATH);
    const tmpPath = path.join(
      prismaDir,
      `local.${process.pid}.${Date.now()}.tmp`,
    );
    const serialized = yield* serializeLocalResolutionPin(pin);
    yield* Result.await(
      writeLocalResolutionPinBoundary(
        () => writeFile(tmpPath, serialized, { encoding: "utf8", signal }),
        "write-temp-file",
        signal,
      ),
    );
    yield* ensureLocalResolutionPinWriteNotAborted(signal);
    // rename does not accept AbortSignal; check before the filesystem boundary.
    yield* Result.await(
      writeLocalResolutionPinBoundary(
        () => rename(tmpPath, pinPath),
        "rename-temp-file",
        signal,
      ),
    );

    return Result.ok(undefined);
  });
}

export async function ensureLocalResolutionPinGitignore(
  cwd: string,
  signal?: AbortSignal,
): Promise<Result<void, LocalResolutionPinGitignoreUpdateError>> {
  const gitignorePath = path.join(cwd, ".gitignore");
  let existing: string | null = null;

  const notAborted = ensureLocalResolutionPinGitignoreUpdateNotAborted(signal);
  if (notAborted.isErr()) {
    return Result.err(notAborted.error);
  }

  const existingResult = await Result.tryPromise({
    try: () => readFile(gitignorePath, { encoding: "utf8", signal }),
    catch: (cause) =>
      signal?.aborted
        ? new LocalResolutionPinGitignoreUpdateAbortedError(cause)
        : new LocalResolutionPinGitignoreUpdateFailedError("read", cause),
  });
  if (existingResult.isErr()) {
    if (
      existingResult.error instanceof
        LocalResolutionPinGitignoreUpdateFailedError &&
      (existingResult.error.cause as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      existing = null;
    } else {
      return Result.err(existingResult.error);
    }
  } else {
    existing = existingResult.value;
  }

  if (existing === null) {
    return writeLocalResolutionPinGitignore(
      gitignorePath,
      ".prisma/\n",
      signal,
    );
  }

  const hasPrismaIgnore = existing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === ".prisma/" || line === ".prisma/local.json");
  if (hasPrismaIgnore) {
    return Result.ok(undefined);
  }

  const next = existing.endsWith("\n")
    ? `${existing}.prisma/\n`
    : `${existing}\n.prisma/\n`;
  return writeLocalResolutionPinGitignore(gitignorePath, next, signal);
}

function ensureLocalResolutionPinWriteNotAborted(
  signal: AbortSignal | undefined,
): Result<void, LocalResolutionPinWriteAbortedError> {
  return Result.try({
    try: () => signal?.throwIfAborted(),
    catch: (cause) => new LocalResolutionPinWriteAbortedError(cause),
  });
}

function serializeLocalResolutionPin(
  pin: LocalResolutionPin,
): Result<
  string,
  LocalResolutionPinSerializationError | LocalResolutionPinWriteAbortedError
> {
  return Result.try({
    try: () => `${JSON.stringify(pin, null, 2)}\n`,
    catch: (cause) => new LocalResolutionPinSerializationError(cause),
  });
}

function writeLocalResolutionPinBoundary(
  run: () => Promise<unknown>,
  operation: "create-directory" | "write-temp-file" | "rename-temp-file",
  signal: AbortSignal | undefined,
): Promise<
  Result<
    void,
    LocalResolutionPinWriteAbortedError | LocalResolutionPinWriteFailedError
  >
> {
  return Result.tryPromise({
    try: async () => {
      await run();
    },
    catch: (cause) =>
      signal?.aborted
        ? new LocalResolutionPinWriteAbortedError(cause)
        : new LocalResolutionPinWriteFailedError(operation, cause),
  });
}

function ensureLocalResolutionPinGitignoreUpdateNotAborted(
  signal: AbortSignal | undefined,
): Result<void, LocalResolutionPinGitignoreUpdateAbortedError> {
  return Result.try({
    try: () => signal?.throwIfAborted(),
    catch: (cause) => new LocalResolutionPinGitignoreUpdateAbortedError(cause),
  });
}

function writeLocalResolutionPinGitignore(
  gitignorePath: string,
  contents: string,
  signal: AbortSignal | undefined,
): Promise<
  Result<
    void,
    | LocalResolutionPinGitignoreUpdateAbortedError
    | LocalResolutionPinGitignoreUpdateFailedError
  >
> {
  return Result.tryPromise({
    try: () => writeFile(gitignorePath, contents, { encoding: "utf8", signal }),
    catch: (cause) =>
      signal?.aborted
        ? new LocalResolutionPinGitignoreUpdateAbortedError(cause)
        : new LocalResolutionPinGitignoreUpdateFailedError("write", cause),
  });
}

function isLocalResolutionPin(value: unknown): value is LocalResolutionPin {
  if (!value || typeof value !== "object") {
    return false;
  }

  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("workspaceId") ||
    !keys.includes("projectId")
  ) {
    return false;
  }

  const candidate = value as Partial<Record<keyof LocalResolutionPin, unknown>>;
  return (
    typeof candidate.workspaceId === "string" &&
    candidate.workspaceId.trim().length > 0 &&
    typeof candidate.projectId === "string" &&
    candidate.projectId.trim().length > 0
  );
}
