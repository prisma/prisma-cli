import { execFile } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { PackedManifest, TarballIo } from "./checks/tarball";

const run = promisify(execFile);

const TGZ_SUFFIX = /\.tgz$/;

/**
 * The real seam. Packs with pnpm (npm pack would leave `workspace:`
 * specifiers unrewritten); installs with npm because that is what real
 * consumers use — `--ignore-scripts` because a conformance check must
 * not execute third-party postinstalls on a publish runner, and
 * COREPACK_ENABLE_STRICT=0 because corepack's npm shim walks up past
 * the sandbox to the repo root, sees pnpm, and refuses.
 *
 * `workDir` holds the packed tarballs, the extraction dirs and the
 * install sandbox. It is deleted at the START of a run, not the end, so
 * a failed run leaves its evidence on disk.
 */
export function realTarballIo(
  workDir: string,
  options: { readonly tarballDir?: string } = {},
): TarballIo {
  const absWork = resolve(workDir);
  rmSync(absWork, { recursive: true, force: true });
  mkdirSync(absWork, { recursive: true });
  // Callers may point packing somewhere meaningful — this repo packs
  // into artifacts/tarballs so the tarballs the checks verified are the
  // exact files CI uploads and attaches to the GitHub Release.
  const tarballDir = resolve(options.tarballDir ?? join(absWork, "tarballs"));
  rmSync(tarballDir, { recursive: true, force: true });

  return {
    async pack(pkgDir) {
      const dest = tarballDir;
      mkdirSync(dest, { recursive: true });
      try {
        const before = new Set(readdirSync(dest));
        await run("pnpm", ["pack", "--pack-destination", dest], {
          cwd: pkgDir,
        });
        const created = readdirSync(dest).find(
          (name) => name.endsWith(".tgz") && !before.has(name),
        );
        if (created === undefined) {
          return { failed: "pnpm pack exited 0 but produced no tarball" };
        }
        return { tarball: join(dest, created) };
      } catch (error) {
        return {
          failed: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async readPackedManifest(tarball) {
      const { stdout } = await run("tar", [
        "-xzOf",
        tarball,
        "package/package.json",
      ]);
      return JSON.parse(stdout) as PackedManifest;
    },

    async readPackedFiles(tarball) {
      const dir = join(absWork, "unpacked", tarballBase(tarball));
      mkdirSync(dir, { recursive: true });
      await run("tar", ["-xzf", tarball, "-C", dir]);
      const root = join(dir, "package");
      const files = new Map<string, string>();
      for (const name of readdirSync(root, {
        recursive: true,
        encoding: "utf8",
      })) {
        if (!name.endsWith(".js") && !name.endsWith(".mjs")) continue;
        files.set(name, readFileSync(join(root, name), "utf8"));
      }
      return files;
    },

    async installSandbox({ sandboxDir, rootTarball, overrides }) {
      const dir = resolve(sandboxDir);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const rootManifest = await this.readPackedManifest(rootTarball);
      const name = manifestName(rootManifest);
      writeFileSync(
        join(dir, "package.json"),
        `${JSON.stringify(
          {
            name: "conformance-sandbox",
            private: true,
            version: "0.0.0",
            dependencies: { [name]: `file:${resolve(rootTarball)}` },
            overrides,
          },
          null,
          2,
        )}\n`,
      );
      try {
        await run(
          "npm",
          ["install", "--no-audit", "--no-fund", "--ignore-scripts"],
          {
            cwd: dir,
            env: { ...process.env, COREPACK_ENABLE_STRICT: "0" },
            maxBuffer: 64 * 1024 * 1024,
          },
        );
        return { ok: true as const };
      } catch (error) {
        return { ok: false as const, output: installErrorOutput(error) };
      }
    },

    readInstalledManifest(sandboxDir, name) {
      const path = join(
        sandboxDir,
        "node_modules",
        ...name.split("/"),
        "package.json",
      );
      try {
        return Promise.resolve(
          JSON.parse(readFileSync(path, "utf8")) as PackedManifest,
        );
      } catch {
        return Promise.resolve(undefined);
      }
    },

    listInstalledCopies(sandboxDir, name) {
      const suffix = join("node_modules", ...name.split("/"), "package.json");
      const copies: { version: string; path: string }[] = [];
      const rootModules = join(sandboxDir, "node_modules");
      let entries: string[];
      try {
        entries = readdirSync(rootModules, {
          recursive: true,
          encoding: "utf8",
        });
      } catch {
        return Promise.resolve([]);
      }
      for (const entry of entries) {
        const full = join(rootModules, entry);
        if (!full.endsWith(suffix) && !entry.endsWith(suffix)) continue;
        try {
          const manifest = JSON.parse(
            readFileSync(full, "utf8"),
          ) as PackedManifest;
          if (manifestName(manifest) === name) {
            copies.push({ version: manifest.version ?? "?", path: full });
          }
        } catch {
          // an unreadable nested manifest is not a copy of the engine
        }
      }
      return Promise.resolve(copies);
    },

    async startBin({
      sandboxDir,
      binName: _binName,
      relPath,
      argv,
      timeoutMs,
    }) {
      const rootManifestPath = join(sandboxDir, "package.json");
      const rootManifest = JSON.parse(
        readFileSync(rootManifestPath, "utf8"),
      ) as {
        dependencies: Record<string, string>;
      };
      const shellName = Object.keys(rootManifest.dependencies)[0] ?? "";
      const binPath = join(
        sandboxDir,
        "node_modules",
        ...shellName.split("/"),
        relPath,
      );
      try {
        const { stdout, stderr } = await run(
          process.execPath,
          [binPath, ...argv],
          {
            cwd: sandboxDir,
            // A near-empty environment: the bin must start for a user
            // whose shell carries none of this repo's variables.
            env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR },
            timeout: timeoutMs,
            killSignal: "SIGKILL",
          },
        );
        return { exitCode: 0, stdout, stderr, timedOut: false };
      } catch (error) {
        const failure = error as {
          code?: number | string;
          killed?: boolean;
          stdout?: string;
          stderr?: string;
        };
        return {
          exitCode: typeof failure.code === "number" ? failure.code : null,
          stdout: failure.stdout ?? "",
          stderr: failure.stderr ?? "",
          timedOut: failure.killed === true,
        };
      }
    },
  };
}

function tarballBase(tarball: string): string {
  const base = tarball.split("/").at(-1) ?? tarball;
  return base.replace(TGZ_SUFFIX, "");
}

function manifestName(manifest: PackedManifest): string {
  return (manifest as { name?: string }).name ?? "";
}

function installErrorOutput(error: unknown): string {
  const failure = error as {
    stdout?: string;
    stderr?: string;
    message?: string;
  };
  return [failure.message, failure.stderr, failure.stdout]
    .filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    )
    .join("\n");
}
