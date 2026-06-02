import path from "node:path";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { LocalStateStore } from "../src/adapters/local-state";
import { DEFAULT_STATE_DIR_NAME } from "../src/shell/runtime";
import { createTempCwd } from "./helpers";

describe("app local state", () => {
  it("persists selected app state under .prisma/cli/state.json by default", async () => {
    const cwd = await createTempCwd();
    const store = new LocalStateStore(path.join(cwd, DEFAULT_STATE_DIR_NAME));

    await store.setSelectedApp("proj_123", {
      id: "app_123",
      name: "hello-world",
    });

    expect(
      JSON.parse(await readFile(path.join(cwd, DEFAULT_STATE_DIR_NAME, "state.json"), "utf8")),
    ).toMatchObject({
      app: {
        selectedByProject: {
          proj_123: {
            id: "app_123",
            name: "hello-world",
          },
        },
      },
    });
  });

  it("keys selected apps by project id", async () => {
    const cwd = await createTempCwd();
    const store = new LocalStateStore(path.join(cwd, DEFAULT_STATE_DIR_NAME));

    await store.setSelectedApp("proj_123", {
      id: "app_123",
      name: "hello-world",
    });
    await store.setSelectedApp("proj_456", {
      id: "app_456",
      name: "billing",
    });

    await expect(store.readSelectedApp("proj_123")).resolves.toEqual({
      id: "app_123",
      name: "hello-world",
    });
    await expect(store.readSelectedApp("proj_456")).resolves.toEqual({
      id: "app_456",
      name: "billing",
    });
  });

  it("rejects local state reads when the command signal is already aborted", async () => {
    const cwd = await createTempCwd();
    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);
    const store = new LocalStateStore(path.join(cwd, DEFAULT_STATE_DIR_NAME), controller.signal);

    await expect(store.read()).rejects.toBe(reason);
  });

  it("persists known live deployments by project and app id", async () => {
    const cwd = await createTempCwd();
    const store = new LocalStateStore(path.join(cwd, DEFAULT_STATE_DIR_NAME));

    await store.setKnownLiveDeployment("proj_123", "app_123", "dep_123");
    await store.setKnownLiveDeployment("proj_123", "app_456", "dep_456");

    expect(
      JSON.parse(await readFile(path.join(cwd, DEFAULT_STATE_DIR_NAME, "state.json"), "utf8")),
    ).toMatchObject({
      app: {
        knownLiveDeploymentByProject: {
          proj_123: {
            app_123: "dep_123",
            app_456: "dep_456",
          },
        },
      },
    });
    await expect(store.readKnownLiveDeployment("proj_123", "app_123")).resolves.toBe("dep_123");
    await expect(store.readKnownLiveDeployment("proj_123", "app_456")).resolves.toBe("dep_456");
  });

  it("clears the selected app only when the deleted app matches", async () => {
    const cwd = await createTempCwd();
    const store = new LocalStateStore(path.join(cwd, DEFAULT_STATE_DIR_NAME));

    await store.setSelectedApp("proj_123", {
      id: "app_123",
      name: "hello-world",
    });
    await store.setSelectedApp("proj_456", {
      id: "app_456",
      name: "billing",
    });

    await store.clearSelectedApp("proj_123", "app_123");

    await expect(store.readSelectedApp("proj_123")).resolves.toBeNull();
    await expect(store.readSelectedApp("proj_456")).resolves.toEqual({
      id: "app_456",
      name: "billing",
    });
  });

  it("clears known live deployment only for the deleted app", async () => {
    const cwd = await createTempCwd();
    const store = new LocalStateStore(path.join(cwd, DEFAULT_STATE_DIR_NAME));

    await store.setKnownLiveDeployment("proj_123", "app_123", "dep_123");
    await store.setKnownLiveDeployment("proj_123", "app_456", "dep_456");

    await store.clearKnownLiveDeployment("proj_123", "app_123");

    await expect(store.readKnownLiveDeployment("proj_123", "app_123")).resolves.toBeNull();
    await expect(store.readKnownLiveDeployment("proj_123", "app_456")).resolves.toBe("dep_456");
  });
});
