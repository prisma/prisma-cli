import { describe, expect, it } from "vitest";

import { canonicalizeWindowsPathKey } from "../src/shell/path-env";

describe("canonicalizeWindowsPathKey", () => {
  it("renames the Windows registry-cased Path key to PATH", () => {
    const env: NodeJS.ProcessEnv = {
      Path: "C:\\Windows\\System32;C:\\Users\\flo\\.bun\\bin",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
    };

    canonicalizeWindowsPathKey(env, "win32");

    expect(Object.keys(env).sort()).toEqual(["ComSpec", "PATH"]);
    expect(env.PATH).toBe("C:\\Windows\\System32;C:\\Users\\flo\\.bun\\bin");
  });

  it("keeps a spread of the env readable and rewritable via env.PATH", () => {
    // The reported failure mode: the compute SDK spreads process.env into a
    // plain object and rebuilds PATH from `baseEnv.PATH`. With the Windows
    // `Path` casing that read is undefined, so the rebuilt PATH loses every
    // inherited entry and the spawned `bun run build` cannot find bun.
    const env: NodeJS.ProcessEnv = { Path: "C:\\Users\\flo\\.bun\\bin" };

    canonicalizeWindowsPathKey(env, "win32");
    const spread = { ...env };

    expect(spread.PATH).toBe("C:\\Users\\flo\\.bun\\bin");
    expect(
      Object.keys(spread).filter((key) => key.toUpperCase() === "PATH"),
    ).toEqual(["PATH"]);
  });

  it("collapses multiple case variants without dropping the value", () => {
    const env: NodeJS.ProcessEnv = {
      path: "ignored",
      PATH: "C:\\kept",
    };

    canonicalizeWindowsPathKey(env, "win32");

    expect(env).toEqual({ PATH: "C:\\kept" });
  });

  it("picks the same variant regardless of insertion order", () => {
    // Several non-canonical spellings and no `PATH`: the sorted fallback must
    // pick deterministically rather than following Object.keys order. "PaTH"
    // sorts before "path" (uppercase precedes lowercase), so it wins both ways.
    const first: NodeJS.ProcessEnv = { path: "C:\\other", PaTH: "C:\\kept" };
    const second: NodeJS.ProcessEnv = { PaTH: "C:\\kept", path: "C:\\other" };

    canonicalizeWindowsPathKey(first, "win32");
    canonicalizeWindowsPathKey(second, "win32");

    expect(first).toEqual({ PATH: "C:\\kept" });
    expect(second).toEqual({ PATH: "C:\\kept" });
  });

  it("leaves a canonical PATH untouched", () => {
    const env: NodeJS.ProcessEnv = { PATH: "C:\\Windows\\System32" };

    canonicalizeWindowsPathKey(env, "win32");

    expect(env).toEqual({ PATH: "C:\\Windows\\System32" });
  });

  it("does nothing when no path variable exists", () => {
    const env: NodeJS.ProcessEnv = { HOME: "C:\\Users\\flo" };

    canonicalizeWindowsPathKey(env, "win32");

    expect(env).toEqual({ HOME: "C:\\Users\\flo" });
  });

  it("is a no-op outside Windows, where casing is significant", () => {
    const env: NodeJS.ProcessEnv = {
      Path: "/opt/custom",
      PATH: "/usr/bin:/bin",
    };

    canonicalizeWindowsPathKey(env, "linux");

    expect(env).toEqual({ Path: "/opt/custom", PATH: "/usr/bin:/bin" });
  });
});
