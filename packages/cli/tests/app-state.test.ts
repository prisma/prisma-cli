import path from "node:path";

import { describe, expect, it } from "vitest";

import { LocalStateStore } from "../src/adapters/local-state";
import { DEFAULT_STATE_DIR_NAME } from "../src/state-dir";
import { createTempCwd } from "./helpers";

describe("app local state", () => {
  it("rejects local state reads when the command signal is already aborted", async () => {
    const cwd = await createTempCwd();
    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);
    const store = new LocalStateStore(
      path.join(cwd, DEFAULT_STATE_DIR_NAME),
      controller.signal,
    );

    await expect(store.read()).rejects.toBe(reason);
  });
});
