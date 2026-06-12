/**
 * Narrows a deploy result to the single-app shape; throws on deploy-all.
 * Kept free of src imports so test files can import it statically without
 * loading the CLI module graph before vi.doMock calls apply.
 */
export function asSingleDeployResult<T extends { result: unknown }>(
  success: T,
): T & { result: Exclude<T["result"], { deployments: unknown }> } {
  if (success.result && typeof success.result === "object" && "deployments" in success.result) {
    throw new Error("Expected a single-app deploy result, got a deploy-all result.");
  }
  return success as T & { result: Exclude<T["result"], { deployments: unknown }> };
}
