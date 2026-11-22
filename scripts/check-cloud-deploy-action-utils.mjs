const DEPLOY_CASE = /accepts the deploy arguments for (.+)$/;

/** The test ran and the action cannot drive the CLI. */
export const EXIT_INCOMPATIBLE = 1;
/** The check could not run, so it says nothing about the CLI. */
export const EXIT_NOT_RUN = 2;

/**
 * Judges a finished run of the action's test. `incompatible` means a case
 * failed; `not-run` means a required deploy case is missing from the run.
 *
 * @param {readonly { name: string, outcome: "pass" | "fail" | "skip" }[]} results
 * @returns {{ verdict: "pass" | "incompatible" | "not-run", problems: string[] }}
 */
export function judgeRun(results) {
  const problems = results
    .filter((result) => result.outcome === "fail")
    .map((result) => `Failed: ${result.name}`);
  const ranDeployTargets = results
    .filter((result) => result.outcome !== "skip")
    .map((result) => DEPLOY_CASE.exec(result.name)?.[1])
    .filter((target) => target !== undefined);
  const missing = [];
  if (!ranDeployTargets.includes("production")) {
    missing.push('"... accepts the deploy arguments for production"');
  }
  if (!ranDeployTargets.some((target) => target !== "production")) {
    missing.push(
      '"... accepts the deploy arguments for <environment>", with an environment other than production',
    );
  }
  for (const title of missing) {
    problems.push(
      `No test titled ${title} ran. This script finds the action's deploy cases by these titles, so the action's test titles may have changed. See docs/oss/release-automation.md.`,
    );
  }
  if (missing.length > 0) return { verdict: "not-run", problems };
  if (problems.length > 0) return { verdict: "incompatible", problems };
  return { verdict: "pass", problems };
}

/**
 * A crash of the check is not a verdict on the CLI, so it must not exit
 * with Node's default 1, which means "incompatible" here.
 *
 * @param {() => Promise<number>} main
 */
export async function exitCodeOf(main) {
  try {
    return await main();
  } catch (error) {
    console.error(
      `::error::The check could not run: ${error instanceof Error ? error.stack : error}`,
    );
    return EXIT_NOT_RUN;
  }
}
