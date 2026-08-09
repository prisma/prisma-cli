import * as protocol from "@prisma/cli-engine/protocol";
import {
  CliStructuredError,
  notOk,
  ok,
  okVoid,
} from "@prisma/cli-engine/protocol";
import { describe, expect, test } from "vitest";

describe("./protocol subpath", () => {
  test("is importable and exports only the protocol runtime surface", () => {
    expect(Object.keys(protocol).sort()).toEqual([
      "CliStructuredError",
      "notOk",
      "ok",
      "okVoid",
    ]);
    expect(protocol.CliStructuredError).toBeTypeOf("function");
    expect(protocol.ok).toBeTypeOf("function");
    expect(protocol.notOk).toBeTypeOf("function");
    expect(protocol.okVoid).toBeTypeOf("function");
  });
});

describe("CliStructuredError.toEnvelope", () => {
  test("minimal error yields exactly ok, code, severity, summary", () => {
    const error = new CliStructuredError("AUTH.NOT_LOGGED_IN", "Not logged in");

    expect(error.toEnvelope()).toEqual({
      ok: false,
      code: "AUTH.NOT_LOGGED_IN",
      severity: "error",
      summary: "Not logged in",
    });
  });

  test("full error yields every envelope field", () => {
    const error = new CliStructuredError(
      "CONFIG.INVALID_SECTION",
      "Section is invalid",
      {
        severity: "warn",
        why: "The section failed validation",
        nextActions: [
          { kind: "user-choice", label: "Correct the section value" },
        ],
        where: { path: "prisma.config.ts", line: 3 },
        meta: { section: "platform" },
        docsUrl: "https://example.invalid/docs/config.invalid-section",
      },
    );

    expect(error.toEnvelope()).toEqual({
      ok: false,
      code: "CONFIG.INVALID_SECTION",
      severity: "warn",
      summary: "Section is invalid",
      why: "The section failed validation",
      nextActions: [
        { kind: "user-choice", label: "Correct the section value" },
      ],
      where: { path: "prisma.config.ts", line: 3 },
      meta: { section: "platform" },
      docsUrl: "https://example.invalid/docs/config.invalid-section",
    });
  });

  test("keeps nextActions as given even when a label repeats why", () => {
    const error = new CliStructuredError(
      "CONFIG.FILE_NOT_FOUND",
      "Config file not found",
      {
        why: "Run init",
        nextActions: [
          { kind: "run-command", label: "Run init", command: "prisma init" },
        ],
      },
    );

    expect(error.toEnvelope()).toEqual({
      ok: false,
      code: "CONFIG.FILE_NOT_FOUND",
      severity: "error",
      summary: "Config file not found",
      why: "Run init",
      nextActions: [
        { kind: "run-command", label: "Run init", command: "prisma init" },
      ],
    });
  });

  test("is() duck-types across module boundaries", () => {
    const error = new protocol.CliStructuredError("A.B", "boom");
    const foreignCopy = Object.assign(new Error("boom"), {
      name: "CliStructuredError",
      code: "A.B",
      toEnvelope: () => ({ ok: false }),
    });

    expect(CliStructuredError.is(error)).toBe(true);
    expect(CliStructuredError.is(foreignCopy)).toBe(true);
    expect(CliStructuredError.is(new Error("boom"))).toBe(false);
    expect(CliStructuredError.is("boom")).toBe(false);
  });
});

describe("Result", () => {
  test("ok carries the value", () => {
    const result = ok(42);

    expect(result.ok).toBe(true);
    expect(result.value).toBe(42);
    expect(result.assertOk()).toBe(42);
    expect(() => result.assertNotOk()).toThrow(
      "Expected NotOk result but got Ok",
    );
  });

  test("notOk carries the failure", () => {
    const failure = new CliStructuredError("A.B", "boom");
    const result = notOk(failure);

    expect(result.ok).toBe(false);
    expect(result.failure).toBe(failure);
    expect(result.assertNotOk()).toBe(failure);
    expect(() => result.assertOk()).toThrow("Expected Ok result but got NotOk");
  });

  test("okVoid returns a singleton void success", () => {
    expect(okVoid()).toBe(okVoid());
    expect(okVoid().ok).toBe(true);
    expect(okVoid().value).toBeUndefined();
  });
});
