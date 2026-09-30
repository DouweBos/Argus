import { z } from "zod";

export const UpdaterPhase = z.enum([
  "available",
  "checking",
  "downloaded",
  "downloading",
  "error",
  "idle",
  "not-available",
]);
export type UpdaterPhase = z.infer<typeof UpdaterPhase>;

export const UpdaterState = z.object({
  /** Current app version. */
  currentVersion: z.string(),
  /** Latest error message from electron-updater, if any. */
  error: z.string().nullable(),
  phase: UpdaterPhase,
  /** Download progress 0..100 while phase === "downloading". */
  progressPercent: z.number(),
  /** Release notes for the available/downloaded version, as plain text. */
  releaseNotes: z.string().nullable(),
  /** ISO 8601 release date of the available/downloaded version. */
  releaseDate: z.string().nullable(),
  /** The version available/downloaded (different from currentVersion). */
  updateVersion: z.string().nullable(),
  /** When the feed was last checked successfully. */
  lastCheckedAt: z.number().nullable(),
});
export type UpdaterState = z.infer<typeof UpdaterState>;

/** Runtime targets that can be detached into their own window (Web can't). */
export const PopoutPlatform = z.enum(["android", "ios", "video"]);
export type PopoutPlatform = z.infer<typeof PopoutPlatform>;

/** macOS TCC status for camera (capture-card) access. */
export const CameraAccessStatus = z.enum([
  "denied",
  "granted",
  "not-determined",
  "restricted",
  "unknown",
]);
export type CameraAccessStatus = z.infer<typeof CameraAccessStatus>;
