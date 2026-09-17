/**
 * Re-export of the typed telemetry event catalog, which `@argus/host` owns so
 * main-process telemetry can read it without importing renderer code.
 */

export * from "@argus/host/telemetryEvents";
