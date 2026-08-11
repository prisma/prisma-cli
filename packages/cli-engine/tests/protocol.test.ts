import * as protocol from "@prisma/cli-engine/protocol";
import {
  CliStructuredError,
  notOk,
  ok,
  okVoid,
  STRUCTURED_ERROR,
} from "@prisma/cli-engine/protocol";
import { describe, expect, test } from "vitest";

describe("./protocol subpath", () => {
  test("is importable and exports only the protocol runtime surface", () => {
    expect(Object.keys(protocol).sort()).toEqual([
      "CliStructuredError",
      "STRUCTURED_ERROR",
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
  test("minimal error yields ok, code, severity, summary, and empty nextActions", () => {
    const error = new CliStructuredError("AUTH.NOT_LOGGED_IN", "Not logged in");

    expect(error.toEnvelope()).toEqual({
      ok: false,
      code: "AUTH.NOT_LOGGED_IN",
      severity: "error",
      summary: "Not logged in",
      nextActions: [],
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

  test("an open-url action carries its address through the envelope untouched", () => {
    const error = new CliStructuredError(
      "REPO.INSTALLATION_REQUIRED",
      "Install the GitHub app first",
      {
        nextActions: [
          {
            kind: "open-url",
            label: "Install the Prisma GitHub app",
            url: "https://github.com/apps/prisma/installations/new",
          },
        ],
      },
    );

    // A URL must never arrive as `command`: that tells a consumer to
    // execute it.
    expect(error.toEnvelope().nextActions).toEqual([
      {
        kind: "open-url",
        label: "Install the Prisma GitHub app",
        url: "https://github.com/apps/prisma/installations/new",
      },
    ]);
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

  test("an optional cause reaches Error.cause and stays out of the envelope", () => {
    const original = new Error("token file unreadable");
    const error = new CliStructuredError("AUTH.CONFIG_INVALID", "Bad config", {
      cause: original,
    });

    expect(error.cause).toBe(original);
    expect(error.toEnvelope()).toEqual({
      ok: false,
      code: "AUTH.CONFIG_INVALID",
      severity: "error",
      summary: "Bad config",
      nextActions: [],
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

  test("the brand is a registry symbol, so every copy looks up the same key", () => {
    expect(STRUCTURED_ERROR).toBe(
      Symbol.for("@prisma/cli-engine.structuredError"),
    );
    expect(new CliStructuredError("A.B", "boom")[STRUCTURED_ERROR]).toBe(true);
  });

  test("is() accepts a branded error whose prototype is not this class", () => {
    // Nothing on the chain leads to CliStructuredError, and it is not
    // even an Error: the brand is the whole claim, which is what a copy
    // of this package built somewhere else can actually hand over.
    const otherCopy = {
      [STRUCTURED_ERROR]: true,
      name: "SomethingElse",
      code: "A.B",
      toEnvelope: () => ({ ok: false }),
    };

    expect(Object.getPrototypeOf(otherCopy)).toBe(Object.prototype);
    expect(otherCopy).not.toBeInstanceOf(Error);
    expect(otherCopy).not.toBeInstanceOf(CliStructuredError);
    expect(CliStructuredError.is(otherCopy)).toBe(true);
  });

  test("is() rejects an ordinary error and anything else unmarked", () => {
    expect(CliStructuredError.is(new Error("boom"))).toBe(false);
    expect(CliStructuredError.is(new TypeError("boom"))).toBe(false);
    expect(CliStructuredError.is({ [STRUCTURED_ERROR]: false })).toBe(false);
    expect(CliStructuredError.is({ code: "A.B" })).toBe(false);
    expect(CliStructuredError.is(null)).toBe(false);
    expect(CliStructuredError.is(undefined)).toBe(false);
    expect(CliStructuredError.is(42)).toBe(false);
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
