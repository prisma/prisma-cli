import { setImmediate as nextTick } from "node:timers/promises";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { disposePromptState, selectPrompt } from "../src/shell/prompt";

describe("selectPrompt", () => {
  it("disposes prompt listeners and pauses input after cleanup", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let rendered = "";
    Object.assign(input, {
      isTTY: true,
      setRawMode: () => input,
    });
    Object.assign(output, {
      isTTY: true,
      columns: 80,
      rows: 24,
    });

    output.setEncoding("utf8");
    output.on("data", (chunk: string) => {
      rendered += chunk;
    });

    const selectionPromise = selectPrompt({
      input,
      output,
      message: "Select a project",
      choices: [
        { label: "Acme Dashboard (proj_123)", value: "proj_123" },
        { label: "Billing API (proj_456)", value: "proj_456" },
      ],
    });

    queueMicrotask(() => {
      input.write("\u001B[B\r");
      input.end();
    });

    const selection = await selectionPromise;
    disposePromptState(input);
    await nextTick();

    expect(selection).toBe("proj_456");
    expect(rendered).toContain("Select a project");
    expect(rendered).toContain("Billing API");
  });
});
