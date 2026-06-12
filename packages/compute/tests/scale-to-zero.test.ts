import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ScaleToZeroGuard, waitUntil } from "../src/index";
import { configureScaleToZeroControlFileForTests } from "../src/scale-to-zero-control";

async function createControlFile(): Promise<{ dir: string; file: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prisma-compute-"));
  const file = path.join(dir, "scale_to_zero_disable");
  await fs.writeFile(file, "");
  configureScaleToZeroControlFileForTests(file);

  return { dir, file };
}

async function readSignals(file: string): Promise<string> {
  return await fs.readFile(file, "utf8");
}

describe("scale-to-zero guard", () => {
  afterEach(async () => {
    vi.useRealTimers();
    configureScaleToZeroControlFileForTests(undefined);
  });

  it("writes acquire and release signals for a disposable guard", async () => {
    const { file } = await createControlFile();

    using guard = new ScaleToZeroGuard();

    expect(await readSignals(file)).toBe("+");
    guard.release();
    expect(await readSignals(file)).toBe("+-");
  });

  it("releases only once when release is called multiple times", async () => {
    const { file } = await createControlFile();
    const guard = new ScaleToZeroGuard();

    guard.release();
    guard.release();
    guard[Symbol.dispose]();

    expect(await readSignals(file)).toBe("+-");
  });

  it("releases automatically when the signal aborts", async () => {
    const { file } = await createControlFile();
    const controller = new AbortController();

    const guard = new ScaleToZeroGuard({ signal: controller.signal });
    expect(await readSignals(file)).toBe("+");

    controller.abort();
    expect(await readSignals(file)).toBe("+-");

    guard.release();
    expect(await readSignals(file)).toBe("+-");
  });

  it("does not acquire when the signal is already aborted", async () => {
    const { file } = await createControlFile();
    const controller = new AbortController();
    controller.abort();

    const guard = new ScaleToZeroGuard({ signal: controller.signal });
    guard.release();

    expect(await readSignals(file)).toBe("");
  });

  it("waitUntil releases after the promise resolves", async () => {
    const { file } = await createControlFile();
    const promise = Promise.resolve("done");

    expect(waitUntil(promise)).toBeUndefined();
    await expect(promise).resolves.toBe("done");
    await Promise.resolve();

    expect(await readSignals(file)).toBe("+-");
  });

  it("waitUntil signal abort releases before a still-pending promise settles", async () => {
    const { file } = await createControlFile();
    const controller = new AbortController();
    let resolvePromise: ((value: string) => void) | undefined;
    const promise = new Promise<string>((resolve) => {
      resolvePromise = resolve;
    });

    expect(waitUntil(promise, { signal: controller.signal })).toBeUndefined();
    expect(await readSignals(file)).toBe("+");

    controller.abort();
    expect(await readSignals(file)).toBe("+-");

    expect(resolvePromise).toBeDefined();
    resolvePromise("done");
    await expect(promise).resolves.toBe("done");
    await Promise.resolve();
    expect(await readSignals(file)).toBe("+-");
  });

  it("is a no-op when the control file is unavailable", async () => {
    configureScaleToZeroControlFileForTests(
      path.join(os.tmpdir(), "missing-scale-to-zero-file"),
    );
    const promise = Promise.resolve("done");

    expect(waitUntil(promise)).toBeUndefined();
    await expect(promise).resolves.toBe("done");
  });

  it("removes the abort listener after manual release", async () => {
    const { file } = await createControlFile();
    const controller = new AbortController();
    const guard = new ScaleToZeroGuard({ signal: controller.signal });

    guard.release();
    controller.abort();

    expect(await readSignals(file)).toBe("+-");
  });
});
