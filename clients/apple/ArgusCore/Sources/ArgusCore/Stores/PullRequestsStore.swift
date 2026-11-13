import ArgusKit
import Foundation
import Observation

/// The pull requests the connected computer's `gh` says are yours to look at,
/// and the one you have open.
///
/// Cleared whenever the active computer changes — another machine's projects
/// answer for another set of repos.
@MainActor
@Observable
public final class PullRequestsStore {
  public internal(set) var pullRequests: [RemotePullRequest] = []
  public internal(set) var detailById: [String: RemotePullRequestDetail] = [:]
  public internal(set) var loaded = false
  public internal(set) var error: String?

  private unowned let host: HostStore

  public init(host: HostStore) {
    self.host = host
  }

  public func clear() {
    pullRequests = []
    detailById = [:]
    loaded = false
    error = nil
  }

  public func refresh() async {
    guard let backend = host.backend else { return }
    struct Result: Decodable { let pull_requests: [RemotePullRequest] }
    do {
      pullRequests = try await backend.request(
        .githubPullRequests, EmptyParams(), as: Result.self
      ).pull_requests
      error = nil
    } catch {
      // A screen left mid-load answered nothing; settling would read as "none".
      if HostStore.isQuiet(error) { return }
      // `gh` missing or unauthenticated is the usual cause, and it is worth
      // saying so rather than showing an empty list.
      fail("Couldn't read pull requests", error)
    }
    loaded = true
  }

  @discardableResult
  public func loadDetail(repo: String, number: Int) async -> RemotePullRequestDetail? {
    guard let backend = host.backend else { return nil }
    struct Params: Encodable {
      let repo: String
      let number: Int
    }
    struct Result: Decodable { let pull_request: RemotePullRequestDetail }
    do {
      let detail = try await backend.request(
        .githubPullRequest, Params(repo: repo, number: number), as: Result.self
      ).pull_request
      detailById[detail.id] = detail

      return detail
    } catch {
      fail("Couldn't read that pull request", error)

      return nil
    }
  }

  /// The unified diff; throws for the screen to show rather than the list's banner.
  public func diff(repo: String, number: Int) async throws -> String {
    guard let backend = host.backend else { return "" }
    return try await backend.request(
      ArgusProtocol.Methods.GithubPullRequestDiff.self, .init(repo: repo, number: number)
    ).diff
  }

  /// Open a PR for a session's branch. The computer works out the base and
  /// head from the session itself.
  public func create(sessionId: String, title: String, body: String, draft: Bool) async -> String? {
    guard let backend = host.backend else { return nil }
    struct Params: Encodable {
      let session_id: String
      let title: String
      let body: String
      let draft: Bool
    }
    struct Result: Decodable {
      let number: Int
      let url: String
    }
    do {
      let result = try await backend.request(
        .githubCreatePullRequest,
        Params(session_id: sessionId, title: title, body: body, draft: draft),
        as: Result.self)
      host.hooks.track(.pullRequestActed(action: .open))
      await refresh()

      return result.url
    } catch {
      fail("Couldn't open that pull request", error)

      return nil
    }
  }

  /// The repo's PR template for a session, nil when it has none.
  public func template(sessionId: String) async -> String? {
    guard let backend = host.backend else { return nil }
    struct Params: Encodable { let session_id: String }
    struct Result: Decodable { let template: String? }
    // Optional: a computer without the method, or no template, starts blank.
    return try? await backend.request(
      .githubPullRequestTemplate, Params(session_id: sessionId), as: Result.self
    ).template
  }

  /// Claude's title and description from the session's commits and diff.
  public struct Draft: Decodable, Sendable, Equatable {
    public let body: String?
    /// Nil from an older computer, which drafts only the description.
    public let title: String?
  }

  /// Nil when Claude couldn't draft one. Throws for the sheet to show, not the list's banner.
  public func fill(sessionId: String, title: String) async throws -> Draft? {
    guard let backend = host.backend else { return nil }
    struct Params: Encodable {
      let session_id: String
      let title: String
    }
    do {
      let draft = try await backend.request(
        .githubFillPullRequest, Params(session_id: sessionId, title: title), as: Draft.self)
      host.hooks.track(.pullRequestActed(action: .fill))

      return draft.body == nil ? nil : draft
    } catch {
      if !HostStore.isQuiet(error) { host.hooks.errorReported(error, "pull_requests") }
      throw error
    }
  }

  @discardableResult
  public func merge(repo: String, number: Int, strategy: RemoteMergeStrategy) async -> Bool {
    guard let backend = host.backend else { return false }
    struct Params: Encodable {
      let repo: String
      let number: Int
      let strategy: String
    }
    do {
      try await backend.request(
        .githubMergePullRequest,
        Params(repo: repo, number: number, strategy: strategy.rawValue),
        as: IgnoredResult.self)
      host.hooks.track(.pullRequestActed(action: .merge))
      await loadDetail(repo: repo, number: number)
      await refresh()

      return true
    } catch {
      fail("Couldn't merge that pull request", error)

      return false
    }
  }

  @discardableResult
  public func comment(repo: String, number: Int, body: String) async -> Bool {
    guard let backend = host.backend else { return false }
    struct Params: Encodable {
      let repo: String
      let number: Int
      let body: String
    }
    do {
      try await backend.request(
        .githubCommentPullRequest, Params(repo: repo, number: number, body: body),
        as: IgnoredResult.self)
      host.hooks.track(.pullRequestActed(action: .comment))
      await loadDetail(repo: repo, number: number)

      return true
    } catch {
      fail("Couldn't post that comment", error)

      return false
    }
  }

  /// Show it, and send it — a failure the user sees is one worth knowing
  /// about, scrubbed of anything from their work.
  private func fail(_ summary: String, _ error: Error) {
    guard !HostStore.isQuiet(error) else { return }
    self.error = "\(summary) — \(HostStore.describe(error))"
    host.hooks.errorReported(error, "pull_requests")
  }
}
