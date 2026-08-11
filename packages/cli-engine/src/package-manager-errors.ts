import type { PackageManagerId } from "./package-manager";
import { CliStructuredError } from "./protocol";

interface PackageManagerOutcome {
  readonly manager: PackageManagerId;
  /** The command line as the user is shown it: secrets redacted. */
  readonly command: string;
  /**
   * The same line with its secrets intact. The next action tells the
   * user to run it themselves, so redacting it would hand them a
   * command that does not work.
   */
  readonly runnableCommand: string;
  readonly exitCode: number;
  /** Bounded and redacted by the time it gets here. */
  readonly stderrTail: string;
  /** Set when nothing ran at all: this host wires no runner. */
  readonly reason?: "runner-unavailable";
}

/** What the engine knows about a package-manager invocation that did
 *  not succeed. */
export type PackageManagerFailure =
  | (PackageManagerOutcome & { readonly form: "install" })
  | (PackageManagerOutcome & {
      readonly form: "run";
      readonly package: string;
    });

function why(failure: PackageManagerFailure): string {
  if (failure.reason === "runner-unavailable") {
    return "This host wires no package-manager runner, so nothing was run.";
  }
  return `${failure.manager} exited with code ${failure.exitCode}.`;
}

/**
 * The single constructor of CLI.PACKAGE_MANAGER_FAILED — both forms of
 * ctx.packages, and the host that can run neither.
 */
export function packageManagerFailedError(
  failure: PackageManagerFailure,
): CliStructuredError {
  const installing = failure.form === "install";
  return new CliStructuredError(
    "CLI.PACKAGE_MANAGER_FAILED",
    installing
      ? `Installing packages with ${failure.manager} failed.`
      : `Running ${failure.package} with ${failure.manager} failed.`,
    {
      why: why(failure),
      nextActions: [
        {
          kind: "run-command",
          label: installing
            ? "Run the install yourself"
            : "Run the command yourself",
          command: failure.runnableCommand,
        },
      ],
      meta: {
        form: failure.form,
        manager: failure.manager,
        command: failure.command,
        exitCode: failure.exitCode,
        stderrTail: failure.stderrTail,
        ...(failure.reason === undefined ? {} : { reason: failure.reason }),
      },
    },
  );
}
