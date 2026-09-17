/**
 * The host platform seam.
 *
 * Everything in `@argus/host` is plain Node. The handful of capabilities that
 * genuinely need a desktop shell — opening a URL in the user's browser, the OS
 * keychain, notification banners, the app version — arrive through this
 * interface instead of an `electron` import. The desktop app installs
 * `ElectronHostPlatform`; a headless host installs `nodeHostPlatform`.
 */

/** OS-backed encryption for tokens at rest (Electron's `safeStorage`). */
export interface SecretStorage {
  /** Whether encryption is actually backed by the OS keychain. */
  isAvailable: () => boolean;
  encrypt: (plaintext: string) => Buffer;
  decrypt: (ciphertext: Buffer) => string;
}

export type HostNotificationUrgency = "critical" | "normal";

export interface HostNotificationOptions {
  title: string;
  body: string;
  urgency?: HostNotificationUrgency;
  /** Button labels, in order. Ignored on platforms without action buttons. */
  actions?: string[];
  /** Invoked with the index of the pressed button. */
  onAction?: (index: number) => void;
  onClick?: () => void;
}

export interface HostPlatform {
  /** Identifies the implementation in logs and diagnostics. */
  readonly name: string;
  /** Whether a user-facing window exists at all. False on a headless host. */
  readonly hasUi: boolean;

  appVersion: () => string;
  isPackaged: () => boolean;
  /** Root of read-only packaged assets (Electron: `process.resourcesPath`). */
  resourcesPath: () => string;
  /** Per-user writable app data directory. */
  userDataPath: () => string;

  openExternal: (url: string) => Promise<void>;
  /** Opens a file with its default application. Returns "" on success. */
  openPath: (target: string) => Promise<string>;
  revealInFinder: (target: string) => void;

  secretStorage: SecretStorage;

  notificationsSupported: () => boolean;
  notify: (options: HostNotificationOptions) => void;

  /** Whether the host's own window currently has focus. */
  isForeground: () => boolean;
  /** Raise and focus the host's window. No-op when headless. */
  focusUi: () => void;
}

/**
 * The plain-Node platform: no window, no keychain, no banners.
 *
 * This is what proves the core runs headless — every capability degrades to a
 * documented no-op rather than throwing, so a CLI or a Linux host boots the
 * whole service layer without Electron on the module graph. Secret storage
 * reports unavailable, which makes callers fall back to their plaintext path.
 */
export function nodeHostPlatform(
  overrides: Partial<HostPlatform> = {},
): HostPlatform {
  const base: HostPlatform = {
    name: "node",
    hasUi: false,
    appVersion: () => process.env.ARGUS_VERSION ?? "0.0.0",
    isPackaged: () => false,
    resourcesPath: () => process.cwd(),
    userDataPath: () => process.cwd(),
    openExternal: async () => undefined,
    openPath: async () => "",
    revealInFinder: () => undefined,
    secretStorage: {
      isAvailable: () => false,
      encrypt: (plaintext) => Buffer.from(plaintext, "utf8"),
      decrypt: (ciphertext) => ciphertext.toString("utf8"),
    },
    notificationsSupported: () => false,
    notify: () => undefined,
    isForeground: () => false,
    focusUi: () => undefined,
  };

  return { ...base, ...overrides };
}

let current: HostPlatform = nodeHostPlatform();

/** Install the platform implementation. Called once during host boot. */
export function setHostPlatform(platform: HostPlatform): void {
  current = platform;
}

/** The installed platform. Defaults to the headless Node implementation. */
export function hostPlatform(): HostPlatform {
  return current;
}

/** Test-only: drop back to the headless default. */
export function resetHostPlatform(): void {
  current = nodeHostPlatform();
}
