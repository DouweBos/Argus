/** EAS Simulator devices (`eas:<hostId>:<slot>`) start a billed Expo session when booted. */

const EAS_DEVICE_ID = /^eas:([^:]+):\d+$/;

/** The EAS host behind a device id, or null for any other device. */
export function easHostIdOf(deviceId: string): string | null {
  return EAS_DEVICE_ID.exec(deviceId)?.[1] ?? null;
}

/** Booting this device would start a billed session; watching a running one doesn't. */
export function isBillableEasStart(
  deviceId: string,
  running: boolean,
): boolean {
  return !running && easHostIdOf(deviceId) !== null;
}

export const EAS_START_TITLE = "Start an EAS Simulator session?";
export const EAS_START_CONFIRM = "Start session (billed)";

/** The cost warning, with the host's limits when known. */
export function easStartMessage(
  limits: { idleMinutes: number; maxSessionMinutes: number } | null,
): string {
  const until = limits
    ? `until you end it, it sits idle for ${String(limits.idleMinutes)} min, or it reaches its ${String(limits.maxSessionMinutes)} min limit`
    : "until you end it, it sits idle, or it reaches its time limit";

  return `It costs money: the session is billed to your Expo account ${until}. It can take a few minutes to start.`;
}
