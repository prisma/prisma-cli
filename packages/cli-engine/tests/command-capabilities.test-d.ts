/**
 * Type-level rules for the capability flags. Type-only (vitest
 * `--typecheck`, never executed).
 *
 * defineCommand has one generic signature rather than an overload per
 * capability, so which surfaces reach a handler's context is decided
 * entirely by inference from the declared flags. These pin all four
 * combinations of the two generic flags, both inference routes — an
 * inline handler, and a handler annotated `CommandHandler<typeof def>`
 * in its own declaration — and an explicitly written `false`.
 *
 * `maySpawn` is the third flag and is deliberately NOT one of these: it
 * is a plain boolean, `ctx.spawn` is on every context, and the
 * restriction is enforced at runtime. The last test pins that declaring
 * it does not disturb the inference of the two that are generic.
 */
import {
  type CommandHandler,
  type CredentialManager,
  defineCommand,
  type PackageOperations,
} from "@prisma/cli-engine";
import { ok } from "@prisma/cli-engine/protocol";
import { expectTypeOf, test } from "vitest";

/** The context a definition's handler is handed. */
type ContextOf<D> = Parameters<CommandHandler<D>>[1];

test("installsPackages alone puts ctx.packages on the context and nothing else", () => {
  const def = defineCommand({
    help: { summary: "Installs packages" },
    installsPackages: true,
    handler: async (_args, ctx) => {
      expectTypeOf(ctx.packages).toEqualTypeOf<PackageOperations>();
      // @ts-expect-error managesCredentials was not declared
      void ctx.credentialManager;
      return ok(ctx.present({ data: null }, { human: () => [] }));
    },
  });

  expectTypeOf(def.installsPackages).toEqualTypeOf<true>();
  expectTypeOf(def.managesCredentials).toEqualTypeOf<false>();
  expectTypeOf<ContextOf<typeof def>>()
    .toHaveProperty("packages")
    .toEqualTypeOf<PackageOperations>();
  expectTypeOf<ContextOf<typeof def>>().not.toHaveProperty("credentialManager");

  const annotated: CommandHandler<typeof def> = async (_args, ctx) => {
    expectTypeOf(ctx.packages).toEqualTypeOf<PackageOperations>();
    // @ts-expect-error managesCredentials was not declared
    void ctx.credentialManager;
    return ok(ctx.present({ data: null }, { human: () => [] }));
  };
  expectTypeOf(annotated).toEqualTypeOf<typeof def.handler>();
});

test("managesCredentials alone puts ctx.credentialManager on the context and nothing else", () => {
  const def = defineCommand({
    help: { summary: "Operates on the credential machinery" },
    managesCredentials: true,
    handler: async (_args, ctx) => {
      expectTypeOf(ctx.credentialManager).toEqualTypeOf<CredentialManager>();
      // @ts-expect-error installsPackages was not declared
      void ctx.packages;
      return ok(ctx.present({ data: null }, { human: () => [] }));
    },
  });

  expectTypeOf(def.managesCredentials).toEqualTypeOf<true>();
  expectTypeOf(def.installsPackages).toEqualTypeOf<false>();
  expectTypeOf<ContextOf<typeof def>>()
    .toHaveProperty("credentialManager")
    .toEqualTypeOf<CredentialManager>();
  expectTypeOf<ContextOf<typeof def>>().not.toHaveProperty("packages");

  const annotated: CommandHandler<typeof def> = async (_args, ctx) => {
    expectTypeOf(ctx.credentialManager).toEqualTypeOf<CredentialManager>();
    // @ts-expect-error installsPackages was not declared
    void ctx.packages;
    return ok(ctx.present({ data: null }, { human: () => [] }));
  };
  expectTypeOf(annotated).toEqualTypeOf<typeof def.handler>();
});

test("both capabilities declared: both surfaces, and the shared context intact", () => {
  const def = defineCommand({
    help: { summary: "Signs in and installs packages" },
    managesCredentials: true,
    installsPackages: true,
    handler: async (_args, ctx) => {
      expectTypeOf(ctx.credentialManager).toEqualTypeOf<CredentialManager>();
      expectTypeOf(ctx.packages).toEqualTypeOf<PackageOperations>();
      return ok(ctx.present({ data: null }, { human: () => [] }));
    },
  });

  expectTypeOf(def.managesCredentials).toEqualTypeOf<true>();
  expectTypeOf(def.installsPackages).toEqualTypeOf<true>();
  expectTypeOf<ContextOf<typeof def>>()
    .toHaveProperty("packages")
    .toEqualTypeOf<PackageOperations>();
  expectTypeOf<ContextOf<typeof def>>()
    .toHaveProperty("credentialManager")
    .toEqualTypeOf<CredentialManager>();
  expectTypeOf<ContextOf<typeof def>>().toHaveProperty("present");
  expectTypeOf<ContextOf<typeof def>>().toHaveProperty("report");

  const annotated: CommandHandler<typeof def> = async (_args, ctx) => {
    expectTypeOf(ctx.credentialManager).toEqualTypeOf<CredentialManager>();
    expectTypeOf(ctx.packages).toEqualTypeOf<PackageOperations>();
    return ok(ctx.present({ data: null }, { human: () => [] }));
  };
  expectTypeOf(annotated).toEqualTypeOf<typeof def.handler>();
});

test("neither capability declared: neither surface", () => {
  const def = defineCommand({
    help: { summary: "An ordinary command" },
    handler: async (_args, ctx) => {
      // @ts-expect-error installsPackages was not declared
      void ctx.packages;
      // @ts-expect-error managesCredentials was not declared
      void ctx.credentialManager;
      return ok(ctx.present({ data: null }, { human: () => [] }));
    },
  });

  expectTypeOf(def.installsPackages).toEqualTypeOf<false>();
  expectTypeOf(def.managesCredentials).toEqualTypeOf<false>();
  expectTypeOf<ContextOf<typeof def>>().not.toHaveProperty("packages");
  expectTypeOf<ContextOf<typeof def>>().not.toHaveProperty("credentialManager");

  const annotated: CommandHandler<typeof def> = async (_args, ctx) => {
    // @ts-expect-error installsPackages was not declared
    void ctx.packages;
    // @ts-expect-error managesCredentials was not declared
    void ctx.credentialManager;
    return ok(ctx.present({ data: null }, { human: () => [] }));
  };
  expectTypeOf(annotated).toEqualTypeOf<typeof def.handler>();
});

test("declaring a capability false is the same as not declaring it", () => {
  const omitted = defineCommand({
    help: { summary: "Declares nothing" },
    handler: null as never,
  });
  const declined = defineCommand({
    help: { summary: "Declares both capabilities false" },
    managesCredentials: false,
    installsPackages: false,
    handler: null as never,
  });

  expectTypeOf(declined.installsPackages).toEqualTypeOf<false>();
  expectTypeOf(declined.managesCredentials).toEqualTypeOf<false>();
  expectTypeOf<ContextOf<typeof declined>>().toEqualTypeOf<
    ContextOf<typeof omitted>
  >();
});

test("the capability generics leave the exit-code catalogue alone", () => {
  const def = defineCommand({
    help: { summary: "Signs in, installs, and reports findings" },
    managesCredentials: true,
    installsPackages: true,
    exitCodes: { 4: "some packages were skipped" },
    handler: null as never,
  });

  const annotated: CommandHandler<typeof def> = async (_args, ctx) => {
    expectTypeOf(ctx.credentialManager).toEqualTypeOf<CredentialManager>();
    expectTypeOf(ctx.packages).toEqualTypeOf<PackageOperations>();
    // @ts-expect-error 7 is outside the command's catalogue
    ctx.present({ data: null, exitCode: 7 }, { human: () => [] });
    return ok(ctx.present({ data: null, exitCode: 4 }, { human: () => [] }));
  };
  expectTypeOf(annotated).toEqualTypeOf<typeof def.handler>();
});

test("maySpawn sits beside the capability flags without widening them", () => {
  const def = defineCommand({
    help: { summary: "Installs packages, then hands over the terminal" },
    managesCredentials: true,
    installsPackages: true,
    maySpawn: true,
    handler: async (_args, ctx) => {
      expectTypeOf(ctx.credentialManager).toEqualTypeOf<CredentialManager>();
      expectTypeOf(ctx.packages).toEqualTypeOf<PackageOperations>();
      return ok(ctx.present({ data: null }, { human: () => [] }));
    },
  });

  expectTypeOf(def.managesCredentials).toEqualTypeOf<true>();
  expectTypeOf(def.installsPackages).toEqualTypeOf<true>();
  expectTypeOf(def.maySpawn).toEqualTypeOf<boolean>();

  const undeclared = defineCommand({
    help: { summary: "Never spawns" },
    handler: null as never,
  });
  expectTypeOf<ContextOf<typeof undeclared>>().toHaveProperty("spawn");
});
