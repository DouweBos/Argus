/**
 * Re-export of the host's central logging sink so renderer code keeps its
 * `@logger` / `@/lib/logger` import path while `@argus/host` owns the module.
 */

export * from "@argus/host/logger";
