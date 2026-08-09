import type {
  CliErrorEnvelope,
  CliStructuredError,
  Diagnostic,
  NextAction,
  Result,
} from "@prisma/cli-engine/protocol";

export const diagnostic: Diagnostic = {
  code: "AUTH.NOT_LOGGED_IN",
  severity: "error",
  summary: "Not logged in",
  fix: "Run prisma auth login",
};

export const nextAction: NextAction = {
  kind: "run-command",
  label: "Sign in",
  command: "prisma auth login",
};

type MutuallyAssignable<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

export const envelopeIsOkFalseAndDiagnostic: MutuallyAssignable<
  CliErrorEnvelope,
  { readonly ok: false } & Diagnostic
> = true;

export const envelopeFromError: CliErrorEnvelope =
  undefined as unknown as ReturnType<CliStructuredError["toEnvelope"]>;

export type VoidResult = Result<void, CliStructuredError>;
