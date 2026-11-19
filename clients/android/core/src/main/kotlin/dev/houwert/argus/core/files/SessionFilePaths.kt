package dev.houwert.argus.core.files

/**
 * Turns a path as an agent wrote it into one `files.read` accepts: relative to the session's
 * worktree. A client doesn't know where the worktree lives, so an absolute path is matched
 * against the session's file list by suffix.
 */
object SessionFilePaths {
  /** Absolute and `~/` paths can only be placed with the session's file list. */
  fun needsFileList(raw: String): Boolean {
    val path = raw.trim()
    return path.startsWith("/") || path.startsWith("~")
  }

  /** The worktree-relative path, or null when [raw] can't name a file in this session. */
  fun relative(raw: String, files: List<String>): String? {
    val path = raw.trim()
    if (path.isEmpty()) return null
    if (needsFileList(path)) return files.filter { path == it || path.endsWith("/$it") }.maxByOrNull { it.length }
    return normalized(path)
  }

  /** `./a/../b.ts` → `b.ts`; null when it climbs out of the worktree. */
  internal fun normalized(path: String): String? {
    val parts = ArrayList<String>()
    for (part in path.split('/').filter { it.isNotEmpty() }) {
      when (part) {
        "." -> continue
        ".." -> if (parts.isEmpty()) return null else parts.removeAt(parts.lastIndex)
        else -> parts += part
      }
    }
    return if (parts.isEmpty()) null else parts.joinToString("/")
  }

  /** The last path component, for titles. */
  fun fileName(path: String): String = path.split('/').lastOrNull { it.isNotEmpty() } ?: path

  /** Everything before the file name, for subtitles; empty at the worktree root. */
  fun directory(path: String): String = path.substringBeforeLast('/', "")
}
