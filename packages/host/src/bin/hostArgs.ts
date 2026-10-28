/** Command-line flags for `argus-host`. `--desktop` and `--server` are read in `hostEnv.ts`. */
export interface HostArgs {
  /** Serve the local UI channel here (`--ui-socket <path>`). */
  uiSocket: string | null;
  /** The app supervising this host, recorded in the host lock (`--owner-pid`). */
  ownerPid: number | null;
  /** `argus-host login`: start linking this computer as soon as it is up. */
  login: boolean;
}

export function parseHostArgs(argv: string[]): HostArgs {
  const value = (flag: string): string | null => {
    const index = argv.indexOf(flag);

    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : null;
  };
  const ownerPid = Number(value("--owner-pid"));

  return {
    uiSocket: value("--ui-socket"),
    ownerPid: Number.isInteger(ownerPid) && ownerPid > 0 ? ownerPid : null,
    login: argv[0] === "login",
  };
}
