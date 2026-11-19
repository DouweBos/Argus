package dev.houwert.argus.core.sessions

import dev.houwert.argus.kit.protocol.generated.RemoteImageAttachment
import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode

/** The first message of an agent that doesn't exist yet, as a start composer collected it. */
data class ComposerStart(
  val message: String,
  val displayText: String,
  val images: List<RemoteImageAttachment> = emptyList(),
  /** Null keeps the starter's default. */
  val permissionMode: RemotePermissionMode? = null,
  /** Picked in the model pill or with `/model`; null lets the runner choose. */
  val model: String? = null,
  /** Picked in the effort pill; null keeps the model's default. */
  val effort: String? = null,
  /** Null is the computer's default runner. */
  val runnerId: String? = null,
  /** The Claude account to pin the session to: `""` follows the computer's default, null leaves it as it is. */
  val accountId: String? = null,
) {
  /** Settings' default model and effort belong to the default runner; another runner picks its own. */
  fun model(defaults: AgentStartDefaults): String? = model ?: if (runnerId == null) defaults.model else null

  fun effort(defaults: AgentStartDefaults): String? = effort ?: if (runnerId == null) defaults.effort else null
}

/** What a start falls back to where the request leaves a choice open: the phone's Settings defaults. */
data class AgentStartDefaults(
  /** A raw permission mode. */
  val mode: String? = null,
  val model: String? = null,
  val effort: String? = null,
)

/** Which branch a new worktree starts from, as the desktop picks it (`app/lib/baseBranch.ts`). */
object BaseBranchChoice {
  val common = listOf("staging", "develop", "dev", "main", "master")

  /**
   * `.argus.json`'s `default_base_branch`, then its protected branches, then the usual names;
   * `origin/<name>` over a local copy the project root has checked out, since that one may have
   * drifted. Else the first local branch.
   */
  fun preselected(local: List<String>, originRefs: List<String>, configured: String?, protected: List<String>, projectRootBranch: String?): String? {
    val origins = originRefs.toSet()
    val seen = HashSet<String>()
    for (name in listOfNotNull(configured) + protected + common) {
      if (!seen.add(name)) continue
      val origin = "origin/$name"
      val hasOrigin = origin in origins
      if (hasOrigin && projectRootBranch == name) return origin
      if (name in local) return name
      if (hasOrigin) return origin
    }
    return local.firstOrNull()
  }

  /** The local branches, plus the origin refs of base-like ones only. */
  fun options(local: List<String>, originRefs: List<String>, protected: List<String>): List<String> {
    val hints = (protected + common).toSet()
    return local + originRefs.filter { it.startsWith("origin/") && it.removePrefix("origin/") in hints }
  }
}
