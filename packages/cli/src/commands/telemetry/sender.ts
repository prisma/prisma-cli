/**
 * Build entry that carries `@repo/cli-telemetry`'s detached sender
 * into the cli's own dist (`dist/sender.js`) — the telemetry
 * package is private and bundled, so the published cli must ship the
 * forkable sender script itself.
 */
import "@repo/cli-telemetry/sender";
