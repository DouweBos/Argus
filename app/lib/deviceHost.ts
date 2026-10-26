/** A device's name, with the device host it runs on when it isn't this Mac. */
export function deviceDisplayName(d: {
  deviceHostLabel?: string;
  name: string;
}): string {
  return d.deviceHostLabel ? `${d.name} on ${d.deviceHostLabel}` : d.name;
}
