import { describe, expect, it } from "vitest";
import {
  type EngineCommandSnapshot,
  sanitizeEngineSnapshot,
} from "../src/sanitize";

describe("sanitizeEngineSnapshot", () => {
  it("extracts the command name and user-supplied flag names, dropping everything else", () => {
    expect(
      sanitizeEngineSnapshot({
        commandPath: ["migration", "new"],
        positionalCount: 2,
        flags: [
          { name: "name", source: "cli" },
          { name: "dry-run", source: "cli" },
          { name: "target", source: "cli" },
          { name: "connection-string", source: "cli" },
        ],
      }),
    ).toEqual({
      command: "migration new",
      flags: ["name", "dry-run", "target", "connection-string"],
    });
  });

  it("returns the empty flag list when no flags were supplied by the user", () => {
    expect(
      sanitizeEngineSnapshot({
        commandPath: ["init"],
        positionalCount: 0,
        flags: [
          { name: "no-install", source: "default" },
          { name: "json", source: "default" },
        ],
      }),
    ).toEqual({ command: "init", flags: [] });
  });

  it("joins multi-segment command paths into a single space-delimited command field", () => {
    expect(
      sanitizeEngineSnapshot({
        commandPath: ["contract", "emit"],
        positionalCount: 0,
        flags: [{ name: "config", source: "cli" }],
      }).command,
    ).toBe("contract emit");
  });

  it("preserves flag declaration order while filtering non-cli sources", () => {
    expect(
      sanitizeEngineSnapshot({
        commandPath: ["migrate"],
        positionalCount: 0,
        flags: [
          { name: "to", source: "cli" },
          { name: "yes", source: "cli" },
          { name: "json", source: "default" },
          { name: "verbose", source: "env" },
        ],
      }).flags,
    ).toEqual(["to", "yes"]);
  });

  it("never leaks positional information — only names survive, the count is dropped", () => {
    const out = sanitizeEngineSnapshot({
      commandPath: ["init"],
      positionalCount: 7,
      flags: [{ name: "target", source: "cli" }],
    });
    expect(out).toEqual({ command: "init", flags: ["target"] });
    expect(JSON.stringify(out)).not.toContain("7");
  });

  it("never includes flag values in its output (there is no value channel in the snapshot)", () => {
    const out = sanitizeEngineSnapshot({
      commandPath: ["migration", "new"],
      positionalCount: 0,
      flags: [{ name: "name", source: "cli" }],
    });
    expect(out.flags).toEqual(["name"]);
    expect(JSON.stringify(out)).not.toContain("customer-acme-payments");
  });

  it("does not pass through extra properties smuggled onto a hostile snapshot object", () => {
    const hostile = {
      commandPath: ["deploy"],
      positionalCount: 1,
      flags: [
        {
          name: "token",
          source: "cli",
          value: "sk_live_SHOULD-NEVER-LEAK",
        } as unknown as EngineCommandSnapshot["flags"][number],
      ],
      argv: ["--token", "sk_live_SHOULD-NEVER-LEAK"],
      positionals: ["/Users/alice/secret.toml"],
    } as unknown as EngineCommandSnapshot;
    const serialised = JSON.stringify(sanitizeEngineSnapshot(hostile));
    expect(serialised).not.toContain("SHOULD-NEVER-LEAK");
    expect(serialised).not.toContain("secret.toml");
    expect(serialised).not.toContain("argv");
  });

  it("drops env- and default-sourced flags even when their names look sensitive", () => {
    expect(
      sanitizeEngineSnapshot({
        commandPath: ["auth", "login"],
        positionalCount: 0,
        flags: [
          { name: "service-token", source: "env" },
          { name: "password-stdin", source: "default" },
        ],
      }).flags,
    ).toEqual([]);
  });

  it("handles an empty commandPath by returning an empty command string", () => {
    expect(
      sanitizeEngineSnapshot({ commandPath: [], positionalCount: 0, flags: [] })
        .command,
    ).toBe("");
  });
});
