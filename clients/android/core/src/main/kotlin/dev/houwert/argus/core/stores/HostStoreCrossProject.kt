package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteProject
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind
import dev.houwert.argus.kit.protocol.generated.RemoteSessionStatus
import dev.houwert.argus.kit.protocol.generated.RemoteSessionAvailability

/** One repository of a cross-project session, as the per-repo sections list it. */
data class CrossProjectRepo(
  val sessionId: String,
  val repoRoot: String,
  val branch: String,
  /** The linked repo's own session once listed; null while it loads. */
  val session: RemoteSession?,
  /** The session the agent runs in, whose worktree is its cwd. */
  val isPrimary: Boolean,
) {
  val name: String get() = repoRoot.trimEnd('/').substringAfterLast('/')
}

/** A repository a conversion couldn't add. */
data class CrossProjectFailure(val repoRoot: String, val error: String)

/** One repository of another session's cross-project session: listed under that one, not on its own. */
val RemoteSession.isLinkedRepo: Boolean get() = crossProjectOf != null

/** "3 repositories" on a cross-project session's row; null on a single-repo one. */
val RemoteSession.crossProjectCaption: String?
  get() = linkedRepos?.takeIf { it.isNotEmpty() }?.let { "${it.size + 1} repositories" }

/** The cross-project session [session] belongs to: itself, its primary, or null for a single-repo one. */
fun HostStore.crossProjectPrimary(session: RemoteSession): RemoteSession? =
  if (!session.linkedRepos.isNullOrEmpty()) session else session.crossProjectOf?.let { session(it) }

/** Every repository of the session's cross-project session, its primary first; empty for a single-repo one. */
fun HostStore.crossProjectRepos(session: RemoteSession): List<CrossProjectRepo> {
  val primary = crossProjectPrimary(session) ?: return emptyList()
  val linked = primary.linkedRepos.orEmpty()
  if (linked.isEmpty()) return emptyList()
  return listOf(CrossProjectRepo(primary.id, primary.repoRoot, primary.branch, primary, isPrimary = true)) +
    linked.map { CrossProjectRepo(it.sessionId, it.repoRoot, it.branch, session(it.sessionId), isPrimary = false) }
}

/** Linked projects the session could span but doesn't yet: what the composer offers to add. */
fun HostStore.crossProjectCandidates(sessionId: String, linked: List<String>): List<RemoteProject> {
  val session = session(sessionId) ?: return emptyList()
  if (session.kind != RemoteSessionKind.worktree || session.isLinkedRepo) return emptyList()
  if (session.status != RemoteSessionStatus.ready || session.availability == RemoteSessionAvailability.unavailable) return emptyList()
  val spanned = session.linkedRepos.orEmpty().map { it.repoRoot }.toSet() + session.repoRoot
  return linked.filterNot { it in spanned }.mapNotNull { root -> projects.value.firstOrNull { it.repoRoot == root } }
}

/**
 * Give the session a worktree of each project on its branch name. The repositories that failed,
 * or null when nothing was added (the error is reported).
 */
suspend fun HostStore.makeCrossProject(sessionId: String, repoRoots: List<String>): List<CrossProjectFailure>? {
  val backend = backend ?: return null
  return try {
    val result = backend.request(Methods.SessionsMakeCrossProject, MethodsTypes.SessionsMakeCrossProjectParams(sessionId, repoRoots))
    for (root in (repoRoots + result.session.repoRoot).toSet()) loadSessions(root)
    result.failed.map { CrossProjectFailure(it.repoRoot, it.error) }
  } catch (e: Exception) {
    report(e, "session:cross_project")
    null
  }
}
