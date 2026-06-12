import { exec } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { parseModule, type ASTNode } from "magicast";

import { sourceRootLineage, type ConfigBackedBuildType } from "@prisma/compute-sdk/config";

import { readBunPackageJson, type BunPackageJsonLike } from "./bun-project";
import type { ResolvedPreviewBuildType } from "./preview-build";

type PackageManager = "bun" | "pnpm" | "yarn" | "npm";
export type PreviewBuildSettingsBuildType = Extract<ResolvedPreviewBuildType, ConfigBackedBuildType>;

/** Legacy build-settings file: no longer read or written, only detected for migration. */
export const PRISMA_APP_CONFIG_FILENAME = "prisma.app.json";

interface ResolvedBuildCommand {
  command: string | null;
  source: string | null;
}

interface StaticNextConfig {
  distDir?: string;
  output?: "standalone" | "export";
}

export interface PreviewBuildSettings {
  buildCommand: string | null;
  buildCommandSource: string | null;
  outputDirectory: string;
  outputDirectorySource: string | null;
}

export interface PreviewBuildSettingsResolution {
  /** "config" when the compute config owns the settings, "inferred" otherwise. */
  status: "config" | "inferred";
  /** The compute config path when status is "config". */
  configPath: string | null;
  relativeConfigPath: string | null;
  settings: PreviewBuildSettings;
}

export type LegacyBuildSettingsDetection =
  | { kind: "absent" }
  | { kind: "matching"; configPath: string }
  | { kind: "invalid"; configPath: string }
  | { kind: "custom"; configPath: string; buildCommand: string | null; outputDirectory: string };

/**
 * Detects a leftover `prisma.app.json`. The file is no longer used: one that
 * matches the effective settings is reported for deletion, one with custom
 * values must be migrated to the compute config so builds never silently
 * change.
 */
export async function detectLegacyBuildSettings(options: {
  appPath: string;
  effective: PreviewBuildSettings;
  signal?: AbortSignal;
}): Promise<LegacyBuildSettingsDetection> {
  const configPath = path.join(options.appPath, PRISMA_APP_CONFIG_FILENAME);
  let content: string;
  try {
    options.signal?.throwIfAborted();
    content = await readFile(configPath, { encoding: "utf8", signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { kind: "absent" };
  }

  let legacy: { buildCommand: string | null; outputDirectory: string };
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const buildCommand = parsed.buildCommand === null || typeof parsed.buildCommand === "string"
      ? (typeof parsed.buildCommand === "string" ? parsed.buildCommand.trim() || null : null)
      : undefined;
    const outputDirectory = typeof parsed.outputDirectory === "string"
      ? normalizeRelativePath(parsed.outputDirectory)
      : undefined;
    if (buildCommand === undefined || !outputDirectory) {
      return { kind: "invalid", configPath };
    }
    legacy = { buildCommand, outputDirectory };
  } catch {
    return { kind: "invalid", configPath };
  }

  const matches = legacy.buildCommand === options.effective.buildCommand
    && legacy.outputDirectory === options.effective.outputDirectory;
  return matches
    ? { kind: "matching", configPath }
    : { kind: "custom", configPath, ...legacy };
}

/** Resolves build settings purely from framework inference; nothing is read or written. */
export async function resolveInferredPreviewBuildSettings(options: {
  appPath: string;
  buildType: ResolvedPreviewBuildType;
  signal?: AbortSignal;
}): Promise<PreviewBuildSettingsResolution> {
  return {
    status: "inferred",
    configPath: null,
    relativeConfigPath: null,
    settings: await resolvePreviewBuildSettings(options),
  };
}


/**
 * Resolves build settings when the compute config owns them: configured
 * fields win, omitted fields fall back to framework defaults.
 */
export async function resolveConfiguredPreviewBuildSettings(options: {
  appPath: string;
  buildType: PreviewBuildSettingsBuildType;
  configured: {
    command: string | null | undefined;
    outputDirectory: string | undefined;
  };
  /** Absolute path of the compute config file owning these settings. */
  configPath: string;
  signal?: AbortSignal;
}): Promise<PreviewBuildSettingsResolution> {
  const configFilename = path.basename(options.configPath);
  const source = `set by ${configFilename}`;
  const needsFallback = options.configured.command === undefined || options.configured.outputDirectory === undefined;
  const fallback = needsFallback ? await resolvePreviewBuildSettings(options) : null;

  return {
    status: "config",
    configPath: options.configPath,
    relativeConfigPath: configFilename,
    settings: {
      buildCommand: options.configured.command !== undefined ? options.configured.command : fallback!.buildCommand,
      buildCommandSource: options.configured.command !== undefined ? source : fallback!.buildCommandSource,
      outputDirectory: options.configured.outputDirectory ?? fallback!.outputDirectory,
      outputDirectorySource: options.configured.outputDirectory !== undefined ? source : fallback!.outputDirectorySource,
    },
  };
}


export async function resolvePreviewBuildSettings(options: {
  appPath: string;
  buildType: ResolvedPreviewBuildType;
  signal?: AbortSignal;
}): Promise<PreviewBuildSettings> {
  switch (options.buildType) {
    // The nuxt and astro strategies invoke the framework CLI and stage fixed
    // output themselves; these settings only describe that for display.
    case "nuxt":
      return {
        buildCommand: "nuxt build",
        buildCommandSource: "Nuxt default",
        outputDirectory: ".output",
        outputDirectorySource: "Nuxt output",
      };
    case "astro":
      return {
        buildCommand: "astro build",
        buildCommandSource: "Astro default",
        outputDirectory: "dist",
        outputDirectorySource: "Astro output",
      };
    case "nextjs": {
      const packageJson = await readBunPackageJson(options.appPath, options.signal);
      const buildCommand = await resolveFrameworkBuildCommand(options.appPath, packageJson, {
        command: "next build",
        source: "Next.js default",
        signal: options.signal,
      });
      const outputRoot = await resolveNextOutputRoot(options.appPath, options.signal);
      return {
        buildCommand: buildCommand.command,
        buildCommandSource: buildCommand.source,
        outputDirectory: joinPosix(outputRoot, "standalone"),
        outputDirectorySource: outputRoot === ".next" ? "Next.js output" : "next.config distDir",
      };
    }
    case "tanstack-start": {
      const packageJson = await readBunPackageJson(options.appPath, options.signal);
      const buildCommand = await resolveFrameworkBuildCommand(options.appPath, packageJson, {
        command: "vite build",
        source: "TanStack Start default",
        signal: options.signal,
      });
      return {
        buildCommand: buildCommand.command,
        buildCommandSource: buildCommand.source,
        outputDirectory: ".output",
        outputDirectorySource: "TanStack Start output",
      };
    }
    case "bun": {
      const packageJson = await readBunPackageJson(options.appPath, options.signal);
      const buildCommand = await resolveFrameworkBuildCommand(options.appPath, packageJson, {
        command: null,
        source: null,
        signal: options.signal,
      });
      return {
        buildCommand: buildCommand.command,
        buildCommandSource: buildCommand.source,
        outputDirectory: ".",
        outputDirectorySource: "app root",
      };
    }
  }
}





export async function hasRootFile(appPath: string, filenames: readonly string[], signal?: AbortSignal): Promise<boolean> {
  let entries: string[];
  try {
    signal?.throwIfAborted();
    entries = await readdir(appPath);
    signal?.throwIfAborted();
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }

  return entries.some((entry) => filenames.includes(entry));
}

export function hasPackageDependency(packageJson: BunPackageJsonLike | null, dependencyName: string): boolean {
  return hasAnyPackageDependency(packageJson, [dependencyName]);
}

export function hasAnyPackageDependency(packageJson: BunPackageJsonLike | null, dependencyNames: readonly string[]): boolean {
  if (!packageJson) {
    return false;
  }

  const dependencyGroups = [packageJson.dependencies, packageJson.devDependencies];
  return dependencyGroups.some((group) => {
    if (!group || typeof group !== "object") {
      return false;
    }

    return dependencyNames.some((dependencyName) => dependencyName in group);
  });
}

async function resolveFrameworkBuildCommand(
  appPath: string,
  packageJson: BunPackageJsonLike | null,
  fallback: {
    command: string | null;
    source: string | null;
    signal?: AbortSignal;
  },
): Promise<ResolvedBuildCommand> {
  const buildScript = readBuildScript(packageJson);
  if (buildScript) {
    const packageManager = await resolvePackageManager(appPath, packageJson, fallback.signal);
    if (!packageManager) {
      return {
        command: buildScript,
        source: "package.json scripts.build",
      };
    }

    return {
      command: `${packageManager} run build`,
      source: "package.json scripts.build",
    };
  }

  return {
    command: fallback.command,
    source: fallback.source,
  };
}

function readBuildScript(packageJson: BunPackageJsonLike | null): string | null {
  if (!packageJson?.scripts || typeof packageJson.scripts !== "object") {
    return null;
  }

  const scripts = packageJson.scripts as Record<string, unknown>;
  if (typeof scripts.build !== "string") {
    return null;
  }

  const buildScript = scripts.build.trim();
  return buildScript.length > 0 ? buildScript : null;
}

async function resolvePackageManager(
  appPath: string,
  packageJson: BunPackageJsonLike | null,
  signal?: AbortSignal,
): Promise<PackageManager | undefined> {
  // Workspace repos keep the lockfile and packageManager field at the
  // workspace root, so check every level from the app up to the source root.
  // The nearest level wins.
  for (const directory of await sourceRootLineage(appPath, signal)) {
    const levelPackageJson = directory === path.resolve(appPath)
      ? packageJson
      : await readBunPackageJson(directory, signal);

    const fromPackageManager = packageManagerFromPackageJson(levelPackageJson?.packageManager);
    if (fromPackageManager) {
      return fromPackageManager;
    }

    if (await pathExists(path.join(directory, "bun.lock"), signal) || await pathExists(path.join(directory, "bun.lockb"), signal)) {
      return "bun";
    }

    if (await pathExists(path.join(directory, "pnpm-lock.yaml"), signal)) {
      return "pnpm";
    }

    if (await pathExists(path.join(directory, "yarn.lock"), signal)) {
      return "yarn";
    }

    if (await pathExists(path.join(directory, "package-lock.json"), signal)) {
      return "npm";
    }
  }
}

function packageManagerFromPackageJson(value: unknown): PackageManager | null {
  if (typeof value !== "string") {
    return null;
  }

  const name = value.split("@")[0];
  return name === "bun" || name === "pnpm" || name === "yarn" || name === "npm" ? name : null;
}

export async function runResolvedBuildCommand(
  appPath: string,
  settings: PreviewBuildSettings,
  failurePrefix: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!settings.buildCommand) {
    return;
  }

  // Workspace repos may hoist binaries like `next` to the workspace root, so
  // expose every node_modules/.bin between the app and its source root.
  const binDirs = (await sourceRootLineage(appPath, signal))
    .map((directory) => path.join(directory, "node_modules", ".bin"));
  await execBuildCommand(settings.buildCommand, appPath, binDirs, failurePrefix, signal);
}

function execBuildCommand(
  command: string,
  cwd: string,
  binDirs: string[],
  failurePrefix: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = exec(command, {
      cwd,
      env: {
        ...process.env,
        PATH: [
          ...binDirs,
          process.env.PATH,
        ].filter(Boolean).join(path.delimiter),
      },
      maxBuffer: 10 * 1024 * 1024,
      signal,
    }, (error, stdout, stderr) => {
      if (error) {
        const output = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
        reject(new Error(`${failurePrefix} failed:\n${output || error.message}`));
        return;
      }

      resolve();
    });

    if (signal?.aborted) {
      child.kill();
    }
  });
}

async function resolveNextOutputRoot(appPath: string, signal?: AbortSignal): Promise<string> {
  const config = await readNextConfig(appPath, signal);
  return config.distDir ?? ".next";
}

async function readNextConfig(appPath: string, signal?: AbortSignal): Promise<StaticNextConfig> {
  for (const fileName of NEXT_CONFIG_FILENAMES) {
    const filePath = path.join(appPath, fileName);
    let content: string;
    try {
      content = await readFile(filePath, { encoding: "utf8", signal });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }

      throw error;
    }

    return readStaticNextConfig(content);
  }

  return {};
}

const NEXT_CONFIG_FILENAMES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.mts",
] as const;

function readStaticNextConfig(content: string): StaticNextConfig {
  try {
    const module = parseModule(content);
    const program = asAstNode(module.$ast);
    const bindings = program ? collectStaticBindings(program) : new Map<string, AstNode>();
    const configObject = program ? findExportedConfigObject(program, bindings) : null;
    if (!configObject) {
      return {};
    }

    const rawDistDir = readStaticStringProperty(configObject, "distDir");
    const output = readStaticStringProperty(configObject, "output");
    const distDir = rawDistDir ? normalizeRelativePath(rawDistDir) : undefined;

    return {
      distDir,
      output: output === "standalone" || output === "export" ? output : undefined,
    };
  } catch {
    return {};
  }
}

export function joinPosix(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

export function nextOutputRootFromStandaloneDirectory(outputDirectory: string): string {
  const normalized = outputDirectory.replace(/\/+$/g, "");
  if (normalized === "standalone") {
    return ".";
  }

  if (normalized.endsWith("/standalone")) {
    const outputRoot = normalized.slice(0, -"/standalone".length);
    return outputRoot.length > 0 ? outputRoot : ".";
  }

  const dirname = path.posix.dirname(normalized);
  return dirname === "." ? "." : dirname;
}

type AstNode = ASTNode & { type: string; [key: string]: unknown };

function asAstNode(value: unknown): AstNode | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const type = (value as { type?: unknown }).type;
  return typeof type === "string" ? value as AstNode : null;
}

function astNodes(value: unknown): AstNode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(asAstNode).filter((node): node is AstNode => Boolean(node));
}

function collectStaticBindings(program: AstNode): Map<string, AstNode> {
  const bindings = new Map<string, AstNode>();
  for (const statement of astNodes(program.body)) {
    if (statement.type !== "VariableDeclaration") {
      continue;
    }

    for (const declaration of astNodes(statement.declarations)) {
      const id = asAstNode(declaration.id);
      const init = asAstNode(declaration.init);
      if (id?.type === "Identifier" && typeof id.name === "string" && init) {
        bindings.set(id.name, init);
      }
    }
  }

  return bindings;
}

function findExportedConfigObject(program: AstNode, bindings: Map<string, AstNode>): AstNode | null {
  for (const statement of astNodes(program.body)) {
    if (statement.type === "ExportDefaultDeclaration") {
      return resolveConfigObject(statement.declaration, bindings);
    }

    if (statement.type !== "ExpressionStatement") {
      continue;
    }

    const expression = asAstNode(statement.expression);
    if (expression?.type !== "AssignmentExpression" || expression.operator !== "=") {
      continue;
    }

    if (isModuleExports(expression.left)) {
      return resolveConfigObject(expression.right, bindings);
    }
  }

  return null;
}

function resolveConfigObject(value: unknown, bindings: Map<string, AstNode>, depth = 0): AstNode | null {
  if (depth > 4) {
    return null;
  }

  const node = unwrapStaticExpression(asAstNode(value));
  if (!node) {
    return null;
  }

  if (node.type === "ObjectExpression") {
    return node;
  }

  if (node.type === "Identifier" && typeof node.name === "string") {
    return resolveConfigObject(bindings.get(node.name), bindings, depth + 1);
  }

  if (node.type === "CallExpression") {
    return resolveConfigObject(astNodes(node.arguments)[0], bindings, depth + 1);
  }

  return null;
}

function unwrapStaticExpression(node: AstNode | null): AstNode | null {
  let current = node;
  while (
    current?.type === "TSAsExpression" ||
    current?.type === "TSSatisfiesExpression" ||
    current?.type === "TSNonNullExpression"
  ) {
    current = asAstNode(current.expression);
  }

  return current;
}

function isModuleExports(value: unknown): boolean {
  const node = asAstNode(value);
  if (node?.type !== "MemberExpression" || node.computed === true) {
    return false;
  }

  const object = asAstNode(node.object);
  const property = asAstNode(node.property);
  return object?.type === "Identifier" &&
    object.name === "module" &&
    property?.type === "Identifier" &&
    property.name === "exports";
}

function readStaticStringProperty(objectExpression: AstNode, propertyName: string): string | undefined {
  for (const property of astNodes(objectExpression.properties)) {
    if (property.type !== "ObjectProperty" || property.computed === true) {
      continue;
    }

    if (propertyKeyName(property.key) !== propertyName) {
      continue;
    }

    const value = unwrapStaticExpression(asAstNode(property.value));
    if (value?.type === "StringLiteral" && typeof value.value === "string") {
      const trimmed = value.value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
  }

  return undefined;
}

function propertyKeyName(value: unknown): string | undefined {
  const key = asAstNode(value);
  if (key?.type === "Identifier" && typeof key.name === "string") {
    return key.name;
  }

  if (key?.type === "StringLiteral" && typeof key.value === "string") {
    return key.value;
  }

  return undefined;
}

export function normalizeRelativePath(value: string): string | undefined {
  const raw = value.trim().replace(/\\/g, "/");
  if (raw.length === 0 || raw.split("/").includes("..")) {
    return undefined;
  }
  // Windows drive-relative paths ("C:dir") escape the base directory but
  // are not absolute under either path.win32 or path.posix.
  if (/^[A-Za-z]:/.test(raw)) {
    return undefined;
  }

  const normalized = path.posix.normalize(raw);
  const segments = normalized.split("/");
  if (
    path.win32.isAbsolute(value) ||
    path.posix.isAbsolute(normalized) ||
    segments.includes("..")
  ) {
    return undefined;
  }

  return normalized === "." ? "." : normalized;
}

async function pathExists(targetPath: string, signal?: AbortSignal): Promise<boolean> {
  try {
    signal?.throwIfAborted();
    await stat(targetPath);
    signal?.throwIfAborted();
    return true;
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }
}
