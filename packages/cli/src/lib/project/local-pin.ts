import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const LOCAL_RESOLUTION_PIN_RELATIVE_PATH = ".prisma/local.json";

export interface LocalResolutionPin {
  workspaceId: string;
  projectId: string;
}

export type LocalResolutionPinReadResult =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "present"; pin: LocalResolutionPin };

export async function readLocalResolutionPin(cwd: string, signal?: AbortSignal): Promise<LocalResolutionPinReadResult> {
  signal?.throwIfAborted();
  try {
    const raw = await readFile(path.join(cwd, LOCAL_RESOLUTION_PIN_RELATIVE_PATH), { encoding: "utf8", signal });
    const parsed = JSON.parse(raw) as unknown;
    if (!isLocalResolutionPin(parsed)) {
      return { kind: "invalid" };
    }

    return {
      kind: "present",
      pin: parsed,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "missing" };
    }
    if (error instanceof SyntaxError) {
      return { kind: "invalid" };
    }
    throw error;
  }
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
  const tmpPath = path.join(prismaDir, `local.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tmpPath, `${JSON.stringify(pin, null, 2)}\n`, { encoding: "utf8", signal });
  signal?.throwIfAborted();
  // rename does not accept AbortSignal; check before the filesystem boundary.
  await rename(tmpPath, pinPath);
}

export async function ensureLocalResolutionPinGitignore(cwd: string, signal?: AbortSignal): Promise<void> {
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

  const next = existing.endsWith("\n") ? `${existing}.prisma/\n` : `${existing}\n.prisma/\n`;
  await writeFile(gitignorePath, next, { encoding: "utf8", signal });
}

function isLocalResolutionPin(value: unknown): value is LocalResolutionPin {
  if (!value || typeof value !== "object") {
    return false;
  }

  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("workspaceId") || !keys.includes("projectId")) {
    return false;
  }

  const candidate = value as Partial<Record<keyof LocalResolutionPin, unknown>>;
  return typeof candidate.workspaceId === "string"
    && candidate.workspaceId.trim().length > 0
    && typeof candidate.projectId === "string"
    && candidate.projectId.trim().length > 0;
}
