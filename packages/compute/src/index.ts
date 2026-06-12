// biome-ignore lint/performance/noBarrelFile: Package entrypoint intentionally re-exports the public API.
export {
  KeepAwakeGuard,
  type KeepAwakeGuardOptions,
  waitUntil,
} from "./keep-awake-guard";
