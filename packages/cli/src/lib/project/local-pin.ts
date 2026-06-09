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

export async function readLocalResolutionPin(
  cwd: string,
  signal?: AbortSignal,
): Promise<Result<LocalResolutionPinReadResult, LocalResolutionPinReadError>> {
  return Result.gen(async function* () {
    yield* ensureLocalResolutionPinReadNotAborted(signal);

    const file = yield* Result.await(readLocalResolutionPinFile(cwd, signal));
    if (file.kind === "missing") {
      return Result.ok({ kind: "missing" } satisfies LocalResolutionPinReadResult);
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

function ensureLocalResolutionPinReadNotAborted(signal: AbortSignal | undefined): Result<void, LocalResolutionPinReadAbortedError> {
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
): Promise<Result<LocalResolutionPinFileReadResult, LocalResolutionPinReadAbortedError | UnhandledException>> {
  const readResult = await Result.tryPromise({
    try: () =>
      readFile(path.join(cwd, LOCAL_RESOLUTION_PIN_RELATIVE_PATH), {
        encoding: "utf8",
        signal,
      }),
    catch: (cause) => signal?.aborted
      ? new LocalResolutionPinReadAbortedError(cause)
      : new UnhandledException({ cause }),
  });
  if (readResult.isErr()) {
    if (readResult.error instanceof UnhandledException && (readResult.error.cause as NodeJS.ErrnoException).code === "ENOENT") {
      return Result.ok({ kind: "missing" });
    }
    return Result.err(readResult.error);
  }

  return Result.ok({ kind: "present", raw: readResult.value });
}

function parseLocalResolutionPin(raw: string): Result<unknown, LocalResolutionPinInvalidJsonError | UnhandledException> {
  return Result.try({
    try: () => JSON.parse(raw) as unknown,
    catch: (cause) => cause instanceof SyntaxError
      ? new LocalResolutionPinInvalidJsonError(cause)
      : new UnhandledException({ cause }),
  });
}

export async function writeLocalResolutionPin(
  cwd: string,
  pin: LocalResolutionPin,
  signal?: AbortSignal,
): Promise<void> {
  const prismaDir = path.join(cwd, ".prisma");
  signal?.throwIfAborted();
  // mkdir does not accept AbortSignal; check before the filesystem boundary.
  await mkdir(prismaDir, { recursive: true });
  const pinPath = path.join(cwd, LOCAL_RESOLUTION_PIN_RELATIVE_PATH);
  const tmpPath = path.join(
    prismaDir,
    `local.${process.pid}.${Date.now()}.tmp`,
  );
  await writeFile(tmpPath, `${JSON.stringify(pin, null, 2)}\n`, {
    encoding: "utf8",
    signal,
  });
  signal?.throwIfAborted();
  // rename does not accept AbortSignal; check before the filesystem boundary.
  await rename(tmpPath, pinPath);
}

export async function ensureLocalResolutionPinGitignore(
  cwd: string,
  signal?: AbortSignal,
): Promise<void> {
  const gitignorePath = path.join(cwd, ".gitignore");
  let existing: string | null = null;

  signal?.throwIfAborted();
  try {
    existing = await readFile(gitignorePath, { encoding: "utf8", signal });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  if (existing === null) {
    await writeFile(gitignorePath, ".prisma/\n", { encoding: "utf8", signal });
    return;
  }

  const hasPrismaIgnore = existing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === ".prisma/" || line === ".prisma/local.json");
  if (hasPrismaIgnore) {
    return;
  }

  const next = existing.endsWith("\n")
    ? `${existing}.prisma/\n`
    : `${existing}\n.prisma/\n`;
  await writeFile(gitignorePath, next, { encoding: "utf8", signal });
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
