/**
 * The minimal prisma.config.ts loader behind Runtime.config (R10):
 * discover the file in cwd (cwd only — no walking up), evaluate it,
 * check the defineConfig version marker, and produce LoadedConfig.
 *
 * Absence is not an error: section validators own absence, so a missing
 * file is an empty LoadedConfig. An evaluated file WITHOUT the marker (a
 * classic Prisma 7 config, which uses the same filename) fails early
 * with one typed diagnostic — the loader never partially interprets an
 * unmarked file, and never guesses.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type LoadedConfig, PRISMA_CONFIG_VERSION } from "./core";
import type { Diagnostic } from "./protocol";

export const CONFIG_FILE_NAME = "prisma.config.ts";

const MARKER_KEY = "$prismaConfig";

function isMarked(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)[MARKER_KEY] === "number"
  );
}

function fileLevelConfig(diagnostic: Diagnostic): LoadedConfig {
  return { sections: {}, diagnostics: [{ section: null, diagnostic }] };
}

function missingMarkerDiagnostic(path: string): Diagnostic {
  return {
    code: "CLI.CONFIG_MISSING_MARKER",
    severity: "error",
    summary:
      "prisma.config.ts is not a Prisma v8 config: its default export does not carry the defineConfig version marker.",
    why: "A classic Prisma 7 config file uses the same name, and the CLI never guesses at unmarked files — a silently misread config is worse than a hard stop.",
    fix: "Wrap the exported config object in defineConfig from @prisma/cli-engine and export the result as the default export.",
    where: { path },
  };
}

function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return (newline === -1 ? text : text.slice(0, newline)).trim();
}

function unsupportedVersionDiagnostic(path: string, found: number): Diagnostic {
  return {
    code: "CLI.CONFIG_INVALID",
    severity: "error",
    summary: `prisma.config.ts declares config version ${found}, but this CLI supports only version ${PRISMA_CONFIG_VERSION}.`,
    fix: "Regenerate the config with a defineConfig matching this CLI, or update the CLI to a version that supports the declared config version.",
    where: { path },
  };
}

function unreadableDiagnostic(path: string, cause: unknown): Diagnostic {
  const message = cause instanceof Error ? cause.message : String(cause);
  return {
    code: "CLI.CONFIG_UNREADABLE",
    severity: "error",
    summary: `prisma.config.ts could not be evaluated: ${firstLine(message)}`,
    fix: "Fix the error in the file, then run the command again.",
    where: { path },
  };
}

export function stampConfigMarker<T extends Record<string, unknown>>(
  config: T,
): T & { readonly $prismaConfig: number } {
  return Object.freeze({ ...config, $prismaConfig: PRISMA_CONFIG_VERSION });
}

export async function loadConfigImpl(cwd: string): Promise<LoadedConfig> {
  const path = join(cwd, CONFIG_FILE_NAME);
  if (!existsSync(path)) {
    return { sections: {}, diagnostics: [] };
  }
  let loaded: unknown;
  try {
    loaded = await import(pathToFileURL(path).href);
  } catch (cause) {
    return fileLevelConfig(unreadableDiagnostic(path, cause));
  }
  const exported = (loaded as { readonly default?: unknown }).default;
  if (!isMarked(exported)) {
    return fileLevelConfig(missingMarkerDiagnostic(path));
  }
  const version = exported[MARKER_KEY] as number;
  if (version !== PRISMA_CONFIG_VERSION) {
    return fileLevelConfig(unsupportedVersionDiagnostic(path, version));
  }
  const sections: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(exported)) {
    if (key !== MARKER_KEY) {
      sections[key] = value;
    }
  }
  return { sections, diagnostics: [] };
}
