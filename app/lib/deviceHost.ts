/** A device's name, with the device host it runs on when it isn't this Mac. */
export function deviceDisplayName(d: {
  deviceHostLabel?: string;
  name: string;
}): string {
  return d.deviceHostLabel ? `${d.name} on ${d.deviceHostLabel}` : d.name;
}

const CREDENTIAL_SOURCE: Record<string, string> = {
  settings: "the saved access token",
  env: "EXPO_TOKEN",
  "eas-login": "the eas login session",
};

/** "Signed in as me via EXPO_TOKEN · 2 EAS projects". */
export function describeEasAccount(a: {
  apps: unknown[];
  credentialSource: string;
  signedInAs: string;
}): string {
  const projects =
    a.apps.length === 1
      ? "1 EAS project"
      : `${String(a.apps.length)} EAS projects`;

  return `Signed in as ${a.signedInAs} via ${CREDENTIAL_SOURCE[a.credentialSource] ?? a.credentialSource} · ${projects}`;
}

/** An EAS host's limits and credential, in one line. */
export function describeEasHost(h: {
  hasToken: boolean;
  idleMinutes: number;
  maxConcurrentSessions: number;
  maxSessionMinutes: number;
  runningSessions: number;
}): string {
  const running =
    h.runningSessions > 0 ? `${String(h.runningSessions)} running · ` : "";
  const credential = h.hasToken ? "token saved" : "EXPO_TOKEN or eas login";

  return `${running}up to ${String(h.maxConcurrentSessions)} × ${String(h.maxSessionMinutes)} min, idle ${String(h.idleMinutes)} min · ${credential}`;
}
