import { z } from "zod";
import {
  DirEntry,
  FileStat,
  HostDirectoryListing,
  MentionPathResult,
  PathKind,
  UploadedAttachment,
} from "../models/files";
import { type CommandSpec, Void } from "./spec";

const SessionFile = z.object({ id: z.string(), relativePath: z.string() });

export const FILE_COMMANDS = {
  read_file: { tier: "admin", params: SessionFile, result: z.string() },
  write_file: {
    tier: "admin",
    params: SessionFile.extend({ content: z.string() }),
    result: Void,
  },
  stat_file: { tier: "admin", params: SessionFile, result: FileStat },
  list_session_files: {
    tier: "admin",
    params: z.object({ id: z.string() }),
    result: z.array(z.string()),
  },
  resolve_mention_path: {
    tier: "admin",
    params: z.object({ id: z.string(), query: z.string() }),
    result: MentionPathResult,
  },
  /**
   * A file dropped on a client whose disk the host does not share arrives as
   * base64 bytes and lands in the session's staging directory.
   */
  upload_session_attachment: {
    tier: "admin",
    params: z.object({ id: z.string(), name: z.string(), data: z.string() }),
    result: UploadedAttachment,
  },
  /** Absolute-path directory listing (the project-settings glob input). */
  list_path: {
    tier: "admin",
    params: z.object({ path: z.string() }),
    result: z.array(DirEntry),
  },
  /**
   * Host-side directory browser — how a remote client picks a project root,
   * since a native open dialog would draw on the wrong machine.
   */
  list_host_directory: {
    tier: "admin",
    params: z.object({ path: z.string().optional() }),
    result: HostDirectoryListing,
  },
  /**
   * Binary-safe file primitives for a remote git runner. Paths are absolute or
   * session-relative, confined like `read_file`.
   */
  read_file_bytes: {
    tier: "admin",
    params: SessionFile,
    /** Base64. */
    result: z.string(),
  },
  write_file_bytes: {
    tier: "admin",
    params: SessionFile.extend({
      /** Base64. */
      data: z.string(),
      executable: z.boolean().optional(),
    }),
    result: Void,
  },
  /** Null when nothing is there. Follows symlinks. */
  stat_path: {
    tier: "admin",
    params: SessionFile,
    result: PathKind.nullable(),
  },
  list_directory_names: {
    tier: "admin",
    params: SessionFile,
    result: z.array(z.string()),
  },
  /** Recursive; a symlink is removed, never followed. */
  remove_path: { tier: "admin", params: SessionFile, result: Void },
  make_directory: { tier: "admin", params: SessionFile, result: Void },
  move_path: {
    tier: "admin",
    params: z.object({ id: z.string(), from: z.string(), to: z.string() }),
    result: Void,
  },
} as const satisfies Record<string, CommandSpec>;
