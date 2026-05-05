import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { updateConfig } from "c12/update";

const PROJECT_FIELD_PATTERN = /project\s*:\s*["']([^"']+)["']/;

export async function readLinkedProjectId(cwd: string): Promise<string | null> {
  const configPath = path.join(cwd, "prisma.config.ts");

  try {
    const contents = await readFile(configPath, "utf8");
    const match = contents.match(PROJECT_FIELD_PATTERN);
    return match?.[1] ?? null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export class UnsafeConfigWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeConfigWriteError";
  }
}

export async function assertLinkedProjectIdWritable(cwd: string): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "prisma-cli-config-"));
  const sourceConfigPath = path.join(cwd, "prisma.config.ts");
  const tempConfigPath = path.join(tempDir, "prisma.config.ts");

  try {
    try {
      await copyFile(sourceConfigPath, tempConfigPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    await applyLinkedProjectIdUpdate(tempDir, "proj_preflight");
  } catch (error) {
    throw toUnsafeConfigWriteError(error);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function writeLinkedProjectId(cwd: string, projectId: string): Promise<void> {
  try {
    await applyLinkedProjectIdUpdate(cwd, projectId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await mkdir(cwd, { recursive: true });
      await applyLinkedProjectIdUpdate(cwd, projectId);
      return;
    }

    throw toUnsafeConfigWriteError(error);
  }
}

async function applyLinkedProjectIdUpdate(cwd: string, projectId: string): Promise<void> {
  await updateConfig({
    cwd,
    configFile: "prisma.config",
    onUpdate(config) {
      config.project = projectId;
    },
    onCreate() {
      return renderProjectConfig(projectId);
    },
  });
}

function renderProjectConfig(projectId: string): string {
  return `export default {\n  project: "${projectId}",\n};\n`;
}

function toUnsafeConfigWriteError(error: unknown): UnsafeConfigWriteError {
  if (error instanceof UnsafeConfigWriteError) {
    return error;
  }

  return new UnsafeConfigWriteError("The existing prisma.config.ts file could not be updated safely.");
}
