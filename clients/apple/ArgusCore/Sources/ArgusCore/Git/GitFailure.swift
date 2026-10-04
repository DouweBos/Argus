import ArgusKit
import Foundation

/// A failed git command, typed the way the desktop's error banner is: what
/// kind of failure it was and which fix git's output points at. Built from
/// the host's `GitError` payload, a gateway runner's `failure`, or — for git
/// this app ran itself — by classifying git's text like the host does.
public struct GitFailure: Equatable, Sendable {
  public enum Kind: String, Sendable, CaseIterable {
    case authRequired = "auth-required"
    case branchCheckedOut = "branch-checked-out"
    case busy
    case cherryPickConflict = "cherry-pick-conflict"
    case detachedHead = "detached-head"
    case dirtyWorkingTree = "dirty-working-tree"
    case hookFailed = "hook-failed"
    case lfsMissing = "lfs-missing"
    case lockFileExists = "lock-file-exists"
    case mergeConflict = "merge-conflict"
    case networkTimeout = "network-timeout"
    case noUpstream = "no-upstream"
    case nonFastForward = "non-fast-forward"
    case nothingToCommit = "nothing-to-commit"
    case nothingToPull = "nothing-to-pull"
    case nothingToPush = "nothing-to-push"
    case outputTooLarge = "output-too-large"
    case rebaseConflict = "rebase-conflict"
    case signingFailed = "signing-failed"
    case unknown
  }

  /// A fix the banner offers, as the desktop's `GitErrorBanner` names them.
  public enum Action: String, Sendable {
    case publishBranch = "publish-branch"
    case pullThenPush = "pull-then-push"
    case forceWithLease = "force-with-lease"
    case retry
    case openConflicts = "open-conflicts"
    case continueOperation = "continue"
    case abortOperation = "abort"
    case stashAndRetry = "stash-and-retry"
    case installLFS = "install-lfs"
    case configureSigning = "configure-signing"
    case copyDetails = "copy-details"

    public var label: String {
      switch self {
      case .publishBranch: "Publish Branch"
      case .pullThenPush: "Pull Then Push"
      case .forceWithLease: "Force Push (with Lease)"
      case .retry: "Retry"
      case .openConflicts: "Open Conflicts"
      case .continueOperation: "Continue"
      case .abortOperation: "Abort"
      case .stashAndRetry: "Stash and Retry"
      case .installLFS: "Install Git LFS"
      case .configureSigning: "Configure Signing"
      case .copyDetails: "Copy Details"
      }
    }

    public var isDestructive: Bool { self == .forceWithLease || self == .abortOperation }
  }

  public var kind: Kind
  public var message: String
  /// The host's recovery hint (`publish-branch`, `pull-then-push`, …).
  public var recovery: String?
  /// What git printed, for Copy Details.
  public var details: String?

  public init(kind: Kind, message: String, recovery: String? = nil, details: String? = nil) {
    self.kind = kind
    self.message = message
    self.recovery = recovery
    self.details = details
  }

  /// The fixes worth offering, primary first. `canRetry` is false when there
  /// is nothing to repeat (the failure didn't come from a retryable action).
  public func actions(canRetry: Bool) -> [Action] {
    let all: [Action] =
      switch kind {
      case .noUpstream: [.publishBranch]
      case .nonFastForward: [.pullThenPush, .forceWithLease]
      case .authRequired, .networkTimeout, .lockFileExists: [.retry, .copyDetails]
      case .mergeConflict, .cherryPickConflict: [.openConflicts, .abortOperation]
      case .rebaseConflict: [.openConflicts, .continueOperation, .abortOperation]
      case .dirtyWorkingTree: [.stashAndRetry]
      case .lfsMissing: [.installLFS, .copyDetails]
      case .signingFailed: [.configureSigning, .copyDetails]
      case .hookFailed: [.retry, .copyDetails]
      case .unknown, .detachedHead, .branchCheckedOut: [.copyDetails]
      case .busy, .outputTooLarge, .nothingToCommit, .nothingToPull, .nothingToPush: []
      }
    return all.filter { canRetry || ($0 != .retry && $0 != .stashAndRetry && $0 != .pullThenPush && $0 != .forceWithLease) }
  }

  // MARK: Sources

  /// The host's serialised `GitError`, carried in a wire error's `data`.
  public init?(error: Error) {
    guard case Transport.TransportError.gateway(let payload) = error,
      let data = payload.data?.objectValue, data["__gitError"] == .bool(true),
      let kind = data["kind"]?.stringValue
    else { return nil }
    self.init(
      kind: Kind(rawValue: kind) ?? .unknown, message: data["message"]?.stringValue ?? payload.message,
      recovery: data["recovery"]?.stringValue, details: data["stderr"]?.stringValue)
  }

  /// A gateway git runner's typed `failure`.
  public init(_ failure: ArgusProtocol.GitRunnerFailure, stderr: String?) {
    self.init(
      kind: Kind(rawValue: failure.kind.rawValue) ?? .unknown, message: failure.message,
      recovery: failure.recovery?.rawValue, details: stderr)
  }

  /// Git's own text (or GroveKit's plain-language version of it), sorted into
  /// a kind the way the host's `classifyGitStderr` does. `operation` tells a
  /// rebase's conflict from a merge's.
  public static func classify(_ text: String, operation: String? = nil) -> GitFailure {
    func has(_ patterns: String...) -> Bool {
      patterns.contains { text.range(of: $0, options: [.regularExpression, .caseInsensitive]) != nil }
    }
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    // GroveKit already words git's failures for people; keep its sentence.
    func failure(_ kind: Kind, _ fallback: String, _ recovery: String? = nil) -> GitFailure {
      GitFailure(kind: kind, message: trimmed.isEmpty ? fallback : trimmed, recovery: recovery, details: text)
    }
    if has("is already (used by|checked out at) worktree") {
      return failure(.branchCheckedOut, "Branch is already checked out in another worktree")
    }
    if has(#"index\.lock"#, #"unable to create '.*\.lock'"#, "another git process is using this repository") {
      return failure(.lockFileExists, "Another git process is holding the index lock")
    }
    if has("no upstream branch", "there is no tracking information", "the current branch .* has no upstream") {
      return failure(.noUpstream, "Branch has no upstream configured", "publish-branch")
    }
    if has(
      "updates were rejected because the tip", "non-fast-forward", "failed to push some refs", #"\(fetch first\)"#,
      "the remote has commits you don't have yet", "someone pushed to the remote branch since your last fetch")
    {
      return failure(.nonFastForward, "Push rejected: remote has changes you don't have locally", "pull-then-push")
    }
    if has(
      "authentication failed", "could not read username", #"permission denied \(publickey\)"#,
      "could not read password", "403 forbidden", "didn't accept your credentials")
    {
      return failure(.authRequired, "Authentication required", "reauthenticate")
    }
    if has(
      "could not resolve host", "unable to access", "operation timed out", "connection timed out",
      "network is unreachable", "couldn't reach the remote")
    {
      return failure(.networkTimeout, "Network error contacting remote", "retry")
    }
    if has(
      #"(?m)^CONFLICT \("#, "merge conflict in", "after resolving the conflicts", "fix conflicts and then commit",
      "resolve all conflicts manually", "there are conflicts to resolve")
    {
      let op = operation?.lowercased() ?? ""
      if op.contains("rebase") { return failure(.rebaseConflict, "Rebase paused on conflict", "resolve-conflicts") }
      if op.contains("cherry") || has("cherry-pick") {
        return failure(.cherryPickConflict, "Cherry-pick paused on conflict", "resolve-conflicts")
      }
      return failure(.mergeConflict, "Merge paused on conflict", "resolve-conflicts")
    }
    if has(
      "your local changes .* would be overwritten", "please commit your changes or stash them",
      "you have unstaged changes", "uncommitted changes would be overwritten")
    {
      return failure(.dirtyWorkingTree, "Working tree has uncommitted changes", "stash-and-retry")
    }
    if has("head is now at"), has("detached") { return failure(.detachedHead, "HEAD is detached") }
    if has("nothing to commit", "no changes added to commit", "nothing added to commit") {
      return failure(.nothingToCommit, "Nothing to commit")
    }
    if has("everything up-to-date") { return failure(.nothingToPush, "Everything up to date") }
    if has("already up to date") { return failure(.nothingToPull, "Already up to date") }
    if has("gpg failed to sign", "failed to sign the data", "secret key not available", "no signing key", "signing failed") {
      return failure(.signingFailed, "Commit signing failed", "configure-signing")
    }
    if has("git-lfs"), has("not installed", "not found", "smudge", "isn't installed") {
      return failure(.lfsMissing, "git-lfs is not available", "install-lfs")
    }
    if has("hook .* failed", "pre-commit hook", "pre-push hook", #"\.git/hooks/"#) {
      return failure(.hookFailed, "A git hook failed", "show-hook-output")
    }
    return failure(.unknown, "git command failed")
  }
}
