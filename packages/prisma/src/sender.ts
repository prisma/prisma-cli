// The detached telemetry sender, forked by the running CLI. It ships
// beside the bin because the runtime resolves it relative to its own
// entry (see @prisma/cli's runtime.ts).
import "@repo/cli-telemetry/sender";
