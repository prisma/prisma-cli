import { exec } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseModule, type ASTNode } from "magicast";

import { CliError } from "../../shell/errors";
import { readBunPackageJson, type BunPackageJsonLike } from "./bun-project";
import type { ResolvedPreviewBuildType } from "./preview-build";

type PackageManager = "bun" | "pnpm" | "yarn" | "npm";
export type PreviewBuildSettingsBuildType = Extract<
  ResolvedPreviewBuildType,
  "nextjs" | "tanstack-start" | "bun"
>;

export const PRISMA_APP_CONFIG_FILENAME = "prisma.app.json";
export const PRISMA_APP_CONFIG_SCHEMA_URL =
  "https://pris.ly/schemas/prisma-app-config.v1.json";

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
  status: "created" | "used";
  configPath: string;
  relativeConfigPath: typeof PRISMA_APP_CONFIG_FILENAME;
  settings: PreviewBuildSettings;
}

export async function resolveOrCreatePreviewBuildSettings(options: {
  appPath: string;
  buildType: PreviewBuildSettingsBuildType;
  signal?: AbortSignal;
}): Promise<PreviewBuildSettingsResolution> {
  const configPath = path.join(options.appPath, PRISMA_APP_CONFIG_FILENAME);
  const existing = await readPreviewBuildSettingsConfig(
    configPath,
    options.signal,
  );
  if (existing) {
    return {
      status: "used",
      configPath,
      relativeConfigPath: PRISMA_APP_CONFIG_FILENAME,
      settings: {
        buildCommand: existing.buildCommand,
        buildCommandSource: null,
        outputDirectory: existing.outputDirectory,
        outputDirectorySource: null,
      },
    };
  }

  const settings = await resolvePreviewBuildSettings(options);
  const config = {
    $schema: PRISMA_APP_CONFIG_SCHEMA_URL,
    buildCommand: settings.buildCommand,
    outputDirectory: settings.outputDirectory,
  };

  try {
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      signal: options.signal,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const raced = await readPreviewBuildSettingsConfig(
        configPath,
        options.signal,
      );
      if (raced) {
        return {
          status: "used",
          configPath,
          relativeConfigPath: PRISMA_APP_CONFIG_FILENAME,
          settings: {
            buildCommand: raced.buildCommand,
            buildCommandSource: null,
            outputDirectory: raced.outputDirectory,
            outputDirectorySource: null,
          },
        };
      }
    }

    throw error;
  }

  return {
    status: "created",
    configPath,
    relativeConfigPath: PRISMA_APP_CONFIG_FILENAME,
    settings,
  };
}

export async function resolvePreviewBuildSettings(options: {
  appPath: string;
  buildType: PreviewBuildSettingsBuildType;
  signal?: AbortSignal;
}): Promise<PreviewBuildSettings> {
  switch (options.buildType) {
    case "nextjs": {
      const packageJson = await readBunPackageJson(
        options.appPath,
        options.signal,
      );
      const buildCommand = await resolveFrameworkBuildCommand(
        options.appPath,
        packageJson,
        {
          command: "next build",
          source: "Next.js default",
          signal: options.signal,
        },
      );
      const outputRoot = await resolveNextOutputRoot(
        options.appPath,
        options.signal,
      );
      return {
        buildCommand: buildCommand.command,
        buildCommandSource: buildCommand.source,
        outputDirectory: joinPosix(outputRoot, "standalone"),
        outputDirectorySource:
          outputRoot === ".next" ? "Next.js output" : "next.config distDir",
      };
    }
    case "tanstack-start": {
      const packageJson = await readBunPackageJson(
        options.appPath,
        options.signal,
      );
      const buildCommand = await resolveFrameworkBuildCommand(
        options.appPath,
        packageJson,
        {
          command: "vite build",
          source: "TanStack Start default",
          signal: options.signal,
        },
      );
      return {
        buildCommand: buildCommand.command,
        buildCommandSource: buildCommand.source,
        outputDirectory: ".output",
        outputDirectorySource: "TanStack Start output",
      };
    }
    case "bun": {
      const packageJson = await readBunPackageJson(
        options.appPath,
        options.signal,
      );
      const buildCommand = await resolveFrameworkBuildCommand(
        options.appPath,
        packageJson,
        {
          command: null,
          source: null,
          signal: options.signal,
        },
      );
      return {
        buildCommand: buildCommand.command,
        buildCommandSource: buildCommand.source,
        outputDirectory: ".",
        outputDirectorySource: "app root",
      };
    }
  }
}

interface PreviewBuildSettingsConfig {
  buildCommand: string | null;
  outputDirectory: string;
}

async function readPreviewBuildSettingsConfig(
  configPath: string,
  signal?: AbortSignal,
): Promise<PreviewBuildSettingsConfig | null> {
  let content: string;
  try {
    content = await readFile(configPath, { encoding: "utf8", signal });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw invalidPrismaAppConfigError(
      configPath,
      `The file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw invalidPrismaAppConfigError(
      configPath,
      "The file must contain a JSON object.",
    );
  }

  const raw = parsed as Record<string, unknown>;
  if (
    "$schema" in raw &&
    raw.$schema !== undefined &&
    typeof raw.$schema !== "string"
  ) {
    throw invalidPrismaAppConfigError(
      configPath,
      "The $schema field must be a string when present.",
    );
  }

  if (raw.buildCommand !== null && typeof raw.buildCommand !== "string") {
    throw invalidPrismaAppConfigError(
      configPath,
      "The buildCommand field must be a string or null.",
    );
  }

  let buildCommand: string | null = null;
  if (typeof raw.buildCommand === "string") {
    buildCommand = raw.buildCommand.trim();
    if (buildCommand.length === 0) {
      throw invalidPrismaAppConfigError(
        configPath,
        "The buildCommand field must not be an empty string. Use null to skip the build step.",
      );
    }
  }

  const outputDirectory = normalizeConfigOutputDirectory(
    configPath,
    raw.outputDirectory,
  );

  return {
    buildCommand,
    outputDirectory,
  };
}

function normalizeConfigOutputDirectory(
  configPath: string,
  value: unknown,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidPrismaAppConfigError(
      configPath,
      "The outputDirectory field must be a non-empty string.",
    );
  }

  const normalized = normalizeRelativePath(value);
  if (!normalized) {
    throw invalidPrismaAppConfigError(
      configPath,
      "The outputDirectory field must be a relative path inside the app directory.",
    );
  }

  return normalized;
}

function invalidPrismaAppConfigError(
  configPath: string,
  why: string,
): CliError {
  return new CliError({
    code: "APP_CONFIG_INVALID",
    domain: "app",
    summary: `Invalid ${PRISMA_APP_CONFIG_FILENAME}`,
    why,
    fix:
      `Edit ${PRISMA_APP_CONFIG_FILENAME} so buildCommand is a string or null ` +
      "and outputDirectory is a relative path inside the app root. " +
      "Delete the file and rerun prisma-cli app deploy to regenerate defaults.",
    where: configPath,
    meta: {
      configPath,
    },
    exitCode: 2,
    nextSteps: ["prisma-cli app deploy"],
  });
}

export async function hasRootFile(
  appPath: string,
  filenames: readonly string[],
  signal?: AbortSignal,
): Promise<boolean> {
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

export function hasPackageDependency(
  packageJson: BunPackageJsonLike | null,
  dependencyName: string,
): boolean {
  return hasAnyPackageDependency(packageJson, [dependencyName]);
}

export function hasAnyPackageDependency(
  packageJson: BunPackageJsonLike | null,
  dependencyNames: readonly string[],
): boolean {
  if (!packageJson) {
    return false;
  }

  const dependencyGroups = [
    packageJson.dependencies,
    packageJson.devDependencies,
  ];
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
    const packageManager = await resolvePackageManager(
      appPath,
      packageJson,
      fallback.signal,
    );
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

function readBuildScript(
  packageJson: BunPackageJsonLike | null,
): string | null {
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
  const fromPackageManager = packageManagerFromPackageJson(
    packageJson?.packageManager,
  );
  if (fromPackageManager) {
    return fromPackageManager;
  }

  if (
    (await pathExists(path.join(appPath, "bun.lock"), signal)) ||
    (await pathExists(path.join(appPath, "bun.lockb"), signal))
  ) {
    return "bun";
  }

  if (await pathExists(path.join(appPath, "pnpm-lock.yaml"), signal)) {
    return "pnpm";
  }

  if (await pathExists(path.join(appPath, "yarn.lock"), signal)) {
    return "yarn";
  }

  if (await pathExists(path.join(appPath, "package-lock.json"), signal)) {
    return "npm";
  }
}

function packageManagerFromPackageJson(value: unknown): PackageManager | null {
  if (typeof value !== "string") {
    return null;
  }

  const name = value.split("@")[0];
  return name === "bun" || name === "pnpm" || name === "yarn" || name === "npm"
    ? name
    : null;
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

  await execBuildCommand(settings.buildCommand, appPath, failurePrefix, signal);
}

function execBuildCommand(
  command: string,
  cwd: string,
  failurePrefix: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = exec(
      command,
      {
        cwd,
        env: {
          ...process.env,
          PATH: [path.join(cwd, "node_modules", ".bin"), process.env.PATH]
            .filter(Boolean)
            .join(path.delimiter),
        },
        maxBuffer: 10 * 1024 * 1024,
        signal,
      },
      (error, stdout, stderr) => {
        if (error) {
          const output = [stderr.trim(), stdout.trim()]
            .filter(Boolean)
            .join("\n");
          reject(
            new Error(`${failurePrefix} failed:\n${output || error.message}`),
          );
          return;
        }

        resolve();
      },
    );

    if (signal?.aborted) {
      child.kill();
    }
  });
}

async function resolveNextOutputRoot(
  appPath: string,
  signal?: AbortSignal,
): Promise<string> {
  const config = await readNextConfig(appPath, signal);
  return config.distDir ?? ".next";
}

async function readNextConfig(
  appPath: string,
  signal?: AbortSignal,
): Promise<StaticNextConfig> {
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
    const bindings = program
      ? collectStaticBindings(program)
      : new Map<string, AstNode>();
    const configObject = program
      ? findExportedConfigObject(program, bindings)
      : null;
    if (!configObject) {
      return {};
    }

    const rawDistDir = readStaticStringProperty(configObject, "distDir");
    const output = readStaticStringProperty(configObject, "output");
    const distDir = rawDistDir ? normalizeRelativePath(rawDistDir) : undefined;

    return {
      distDir,
      output:
        output === "standalone" || output === "export" ? output : undefined,
    };
  } catch {
    return {};
  }
}

export function joinPosix(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

export function nextOutputRootFromStandaloneDirectory(
  outputDirectory: string,
): string {
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
  return typeof type === "string" ? (value as AstNode) : null;
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

function findExportedConfigObject(
  program: AstNode,
  bindings: Map<string, AstNode>,
): AstNode | null {
  for (const statement of astNodes(program.body)) {
    if (statement.type === "ExportDefaultDeclaration") {
      return resolveConfigObject(statement.declaration, bindings);
    }

    if (statement.type !== "ExpressionStatement") {
      continue;
    }

    const expression = asAstNode(statement.expression);
    if (
      expression?.type !== "AssignmentExpression" ||
      expression.operator !== "="
    ) {
      continue;
    }

    if (isModuleExports(expression.left)) {
      return resolveConfigObject(expression.right, bindings);
    }
  }

  return null;
}

function resolveConfigObject(
  value: unknown,
  bindings: Map<string, AstNode>,
  depth = 0,
): AstNode | null {
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
    return resolveConfigObject(
      astNodes(node.arguments)[0],
      bindings,
      depth + 1,
    );
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
  return (
    object?.type === "Identifier" &&
    object.name === "module" &&
    property?.type === "Identifier" &&
    property.name === "exports"
  );
}

function readStaticStringProperty(
  objectExpression: AstNode,
  propertyName: string,
): string | undefined {
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

function normalizeRelativePath(value: string): string | undefined {
  const raw = value.trim().replace(/\\/g, "/");
  if (raw.length === 0 || raw.split("/").includes("..")) {
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

async function pathExists(
  targetPath: string,
  signal?: AbortSignal,
): Promise<boolean> {
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
