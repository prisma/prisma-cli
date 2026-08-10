import * as engine from "@prisma/cli-engine";
import {
  createCli,
  defineCommand,
  defineConfigSection,
  defineServerCommand,
  defineSessionCommand,
  flag,
  positional,
} from "@prisma/cli-engine";
import * as testing from "@prisma/cli-engine/testing";
import { createTestCli } from "@prisma/cli-engine/testing";
import { describe, expect, test } from "vitest";

describe("main export", () => {
  test("exposes exactly the definition-surface runtime values", () => {
    expect(Object.keys(engine).sort()).toEqual([
      "PRESENTED",
      "PRISMA_CONFIG_VERSION",
      "authServiceError",
      "createCli",
      "credentialsRequiredError",
      "defineCommand",
      "defineCommandFamily",
      "defineConfig",
      "defineConfigSection",
      "defineServerCommand",
      "defineSessionCommand",
      "environmentSessionMutationError",
      "flag",
      "loadConfig",
      "noSessionForWorkspaceError",
      "positional",
      "serviceTokenRejectedError",
    ]);
  });

  test("the ./testing subpath exposes exactly the harness", () => {
    expect(Object.keys(testing).sort()).toEqual([
      "TestCredentialManager",
      "createTestCli",
      "mintTestJwt",
    ]);
  });
});

describe("definition constructors", () => {
  const handler = (async () => {
    throw new Error("never runs");
  }) as never;

  test("defineCommand stamps result-command and preserves the definition", () => {
    const definition = defineCommand({
      help: { summary: "Check" },
      exitCodes: { 4: "findings" },
      handler,
    });

    expect(definition.kind).toBe("result-command");
    expect(definition.help).toEqual({
      summary: "Check",
      description: undefined,
      examples: [],
    });
    expect(definition.args).toEqual({ flags: {}, positionals: {} });
    expect(definition.needs).toEqual({
      config: undefined,
      credentials: false,
      dependencies: [],
      interaction: false,
    });
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
    expect(definition.args).toEqual({ flags: {}, positionals: {} });
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

describe("construction validation", () => {
  const command = defineCommand({
    help: { summary: "Noop" },
    handler: null as never,
  });

  test("an empty mount fails construction", () => {
    expect(() => createTestCli({ commands: {} })).toThrow(
      "at least one mounted command",
    );
  });

  test("createCli requires a groups entry for every mount prefix", () => {
    expect(() =>
      createCli({
        name: "x",
        version: "0",
        commandFamilies: [],
        groups: {},
        commands: { "auth whoami": command },
      }),
    ).toThrow("unknown group 'auth'");
  });

  test("a command mount colliding with a group prefix fails construction", () => {
    expect(() =>
      createTestCli({
        commands: { auth: command, "auth whoami": command },
        groups: { auth: { brief: "Authentication" } },
      }),
    ).toThrow("collides");
  });

  test("reserved shared-family flag names fail construction", () => {
    const offender = defineCommand({
      help: { summary: "Offender" },
      args: { flags: { json: flag.boolean({ brief: "mine" }) } },
      handler: null as never,
    });
    expect(() => createTestCli({ commands: { offender } })).toThrow(
      "reserved flag 'json'",
    );
  });

  test("a 'version' flag fails construction (--version is intercepted globally)", () => {
    const offender = defineCommand({
      help: { summary: "Offender" },
      args: { flags: { version: flag.boolean({ brief: "mine" }) } },
      handler: null as never,
    });
    expect(() => createTestCli({ commands: { offender } })).toThrow(
      "reserved flag 'version'",
    );
  });

  test("reserved aliases fail construction", () => {
    const offender = defineCommand({
      help: { summary: "Offender" },
      args: { flags: { quick: flag.boolean({ brief: "quick", alias: "q" }) } },
      handler: null as never,
    });
    expect(() => createTestCli({ commands: { offender } })).toThrow(
      "reserved alias '-q'",
    );
  });

  test("non-camelCase flag keys fail construction", () => {
    const offender = defineCommand({
      help: { summary: "Offender" },
      args: { flags: { "data-proxy": flag.boolean({ brief: "proxy" }) } },
      handler: null as never,
    });
    expect(() => createTestCli({ commands: { offender } })).toThrow(
      "must be camelCase",
    );
  });

  test("a variadic positional that is not last fails construction", () => {
    const offender = defineCommand({
      help: { summary: "Offender" },
      args: {
        positionals: {
          rest: positional.variadic({ brief: "rest", placeholder: "extra" }),
          name: positional.string({ brief: "name", placeholder: "name" }),
        },
      },
      handler: null as never,
    });
    expect(() => createTestCli({ commands: { offender } })).toThrow(
      "must be declared last",
    );
  });

  test("integer-like positional keys fail construction", () => {
    const offender = defineCommand({
      help: { summary: "Offender" },
      args: {
        positionals: {
          "0": positional.string({ brief: "zero", placeholder: "zero" }),
        },
      },
      handler: null as never,
    });
    expect(() => createTestCli({ commands: { offender } })).toThrow(
      "integer-like",
    );
  });

  test("documented exit codes outside 4-99 fail construction", () => {
    const offender = defineCommand({
      help: { summary: "Offender" },
      exitCodes: { 3: "reserved for user abort" },
      handler: null as never,
    });
    expect(() => createTestCli({ commands: { offender } })).toThrow(
      "must be integers in 4-99",
    );
  });
});
