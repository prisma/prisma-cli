import * as engine from "@prisma/cli-engine";
import { describe, expect, test } from "vitest";
import {
  createCli,
  createTestCli,
  defineCommand,
  defineConfigSection,
  defineServerCommand,
  defineSessionCommand,
  flag,
  positional,
} from "../src/index";

describe("main export", () => {
  test("exposes exactly the definition-surface runtime values", () => {
    expect(Object.keys(engine).sort()).toEqual([
      "FLAG",
      "POSITIONAL",
      "PRESENTED",
      "createCli",
      "createTestCli",
      "defineCommand",
      "defineConfigSection",
      "defineServerCommand",
      "defineSessionCommand",
      "flag",
      "positional",
    ]);
  });
});

describe("definition constructors", () => {
  const handler = async () => ({ default: null as never });

  test("defineCommand stamps result-command and preserves the definition", () => {
    const definition = defineCommand({
      help: { summary: "Check" },
      exitCodes: { 4: "findings" },
      handler,
    });

    expect(definition.kind).toBe("result-command");
    expect(definition.help).toEqual({ summary: "Check" });
    expect(definition.exitCodes).toEqual({ 4: "findings" });
    expect(definition.handler).toBe(handler);
    expect(Object.isFrozen(definition)).toBe(true);
  });

  test("defineSessionCommand stamps session-command", () => {
    const definition = defineSessionCommand({
      help: { summary: "Dev" },
      handler,
    });

    expect(definition.kind).toBe("session-command");
    expect(Object.isFrozen(definition)).toBe(true);
  });

  test("defineServerCommand stamps server-command", () => {
    const definition = defineServerCommand({
      help: { summary: "Lsp" },
      handler,
    });

    expect(definition.kind).toBe("server-command");
    expect(Object.isFrozen(definition)).toBe(true);
  });

  test("defineConfigSection couples name and validator", () => {
    const validate = () => ({ ok: true, value: 1, diagnostics: [] }) as const;
    const section = defineConfigSection({ name: "check", validate });

    expect(section.name).toBe("check");
    expect(section.validate).toBe(validate);
    expect(Object.isFrozen(section)).toBe(true);
  });
});

describe("flag and positional builders", () => {
  test("flag builders record their spec and kind", () => {
    expect(flag.string({ brief: "b", placeholder: "p", alias: "s" })).toEqual({
      type: "string",
      brief: "b",
      placeholder: "p",
      alias: "s",
    });
    expect(flag.requiredString({ brief: "b" })).toEqual({
      type: "requiredString",
      brief: "b",
    });
    expect(flag.number({ brief: "b", default: 3 })).toEqual({
      type: "number",
      brief: "b",
      default: 3,
    });
    expect(flag.boolean({ brief: "b", alias: "f" })).toEqual({
      type: "boolean",
      brief: "b",
      alias: "f",
    });
    expect(flag.enum({ brief: "b", values: ["a", "b"], default: "a" })).toEqual(
      {
        type: "enum",
        brief: "b",
        values: ["a", "b"],
        default: "a",
      },
    );
    expect(flag.repeated({ brief: "b", placeholder: "p" })).toEqual({
      type: "repeated",
      brief: "b",
      placeholder: "p",
    });
    expect(Object.isFrozen(flag.boolean({ brief: "b" }))).toBe(true);
  });

  test("positional builders record their spec and kind", () => {
    expect(positional.string({ brief: "b", placeholder: "p" })).toEqual({
      type: "string",
      brief: "b",
      placeholder: "p",
    });
    expect(positional.optionalString({ brief: "b", placeholder: "p" })).toEqual(
      {
        type: "optionalString",
        brief: "b",
        placeholder: "p",
      },
    );
    expect(positional.variadic({ brief: "b", placeholder: "p" })).toEqual({
      type: "variadic",
      brief: "b",
      placeholder: "p",
    });
    expect(
      Object.isFrozen(positional.string({ brief: "b", placeholder: "p" })),
    ).toBe(true);
  });
});

describe("execution placeholders", () => {
  test("createCli throws not-implemented until the execution dispatch lands", () => {
    expect(() =>
      createCli({
        name: "x",
        version: "0",
        products: [],
        groups: {},
        commands: {},
      }),
    ).toThrow("createCli is not implemented yet");
  });

  test("createTestCli throws not-implemented until the execution dispatch lands", () => {
    expect(() => createTestCli({ commands: {} })).toThrow(
      "createTestCli is not implemented yet",
    );
  });
});
