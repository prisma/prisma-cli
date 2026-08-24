import { readFile } from "node:fs/promises";
import path from "node:path";
import { PnpmTool, YarnTool } from "@manypkg/tools";

/**
 * The workspace member directories declared by the root's workspace
 * config, expanded from its globs by @manypkg/tools. Enumeration reads
 * the declared globs from plain files (pnpm-workspace.yaml or
 * package.json) and its glob expansion ignores node_modules, so a
 * package is resolvable from a member directory only because the user
 * declared that member — never because something was found by scanning.
 *
 * PnpmTool covers pnpm; YarnTool reads the package.json `workspaces`
 * field in both its array and `{ packages }` forms, which is how npm,
 * Yarn (Plug'n'Play included — the globs live in plain files), and bun
 * all declare their members. Only directories holding a package.json
 * come back.
 */
export async function workspaceMemberDirs(root: string): Promise<string[]> {
  const dirs = new Set<string>();
  if (await hasPnpmWorkspace(root)) {
    for (const dir of await memberDirsVia(PnpmTool, root)) {
      dirs.add(dir);
    }
  }
  if (await hasPackageJsonWorkspaces(root)) {
    for (const dir of await memberDirsVia(YarnTool, root)) {
      dirs.add(dir);
    }
  }
  dirs.delete(path.resolve(root));
  return [...dirs].sort();
}

interface WorkspaceTool {
  getPackages(directory: string): Promise<{
    packages: readonly { dir: string }[];
  }>;
}

async function memberDirsVia(
  tool: WorkspaceTool,
  root: string,
): Promise<string[]> {
  try {
    const { packages } = await tool.getPackages(root);
    return packages.map((pkg) => path.resolve(pkg.dir));
  } catch {
    return [];
  }
}

async function hasPnpmWorkspace(root: string): Promise<boolean> {
  try {
    await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8");
    return true;
  } catch {
    return false;
  }
}

async function hasPackageJsonWorkspaces(root: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    ) as { workspaces?: unknown };
    return manifest.workspaces !== undefined;
  } catch {
    return false;
  }
}
