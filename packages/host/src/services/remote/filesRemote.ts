/**
 * The phone's read-only window on a session's files: one file at a time, and
 * worktree search. Confined to the session's own worktree — unlike the admin
 * `code_read_file`, never another project or an absolute path.
 */

import type { CodeFile, MethodParams } from "@argus/remote-protocol";
import path from "node:path";
import type { z } from "zod";
import { readCodeFile } from "../code/files";
import { clientPath } from "../code/paths";
import {
  cancelCodeSearch,
  codeSearchSession,
  startCodeSearch,
} from "../code/search";
import { resolveContainedPath } from "../file/operations";

export async function readSessionFile(
  sessionId: string,
  requested: string,
): Promise<CodeFile> {
  if (path.isAbsolute(requested)) {
    throw "Path must be relative to the session";
  }
  const absolute = await resolveContainedPath(sessionId, requested, {
    mustExist: true,
  });
  const rel = await clientPath(sessionId, absolute);
  if (rel === null || path.isAbsolute(rel)) {
    throw "Path is outside this session";
  }

  return readCodeFile(sessionId, rel);
}

export function searchSessionFiles(
  p: z.output<(typeof MethodParams)["files.search"]>,
): { search_id: string } {
  const { searchId } = startCodeSearch(
    p.session_id,
    {
      query: p.query,
      regex: p.regex,
      caseSensitive: p.case_sensitive,
      wholeWord: p.whole_word,
      include: p.include,
      exclude: p.exclude,
      maxResults: p.max_results,
    },
    p.search_id,
  );

  return { search_id: searchId };
}

/** Only a search of this session: a scoped guest can't stop someone else's. */
export function cancelSessionSearch(
  sessionId: string,
  searchId: string,
): { accepted: boolean } {
  if (codeSearchSession(searchId) !== sessionId) {
    return { accepted: false };
  }
  cancelCodeSearch(searchId);

  return { accepted: true };
}
