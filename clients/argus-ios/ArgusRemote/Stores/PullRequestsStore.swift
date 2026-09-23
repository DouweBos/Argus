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
final class PullRequestsStore {
  var pullRequests: [RemotePullRequest] = []
  var detailById: [String: RemotePullRequestDetail] = [:]
  var loaded = false
  var error: String?

  private unowned let app: AppStore

  init(app: AppStore) {
    self.app = app
  }

  func clear() {
    pullRequests = []
    detailById = [:]
    loaded = false
    error = nil
  }

  func refresh() async {
    guard let transport = app.transport else { return }
    struct Result: Decodable { let pull_requests: [RemotePullRequest] }
    do {
      pullRequests = try await transport.request(
        .githubPullRequests, EmptyParams(), as: Result.self
      ).pull_requests
      error = nil
    } catch {
      // `gh` missing or unauthenticated is the usual cause, and it is worth
      // saying so rather than showing an empty list.
      self.error = "Couldn't read pull requests — \(AppStore.describe(error))"
    }
    loaded = true
  }

  @discardableResult
  func loadDetail(repo: String, number: Int) async -> RemotePullRequestDetail? {
    guard let transport = app.transport else { return nil }
    struct Params: Encodable {
      let repo: String
      let number: Int
    }
    struct Result: Decodable { let pull_request: RemotePullRequestDetail }
    do {
      let detail = try await transport.request(
        .githubPullRequest, Params(repo: repo, number: number), as: Result.self
      ).pull_request
      detailById[detail.id] = detail

      return detail
    } catch {
      self.error = "Couldn't read that pull request — \(AppStore.describe(error))"

      return nil
    }
  }

  /// Open a PR for a session's branch. The computer works out the base and
  /// head from the session itself.
  func create(sessionId: String, title: String, body: String, draft: Bool) async -> String? {
    guard let transport = app.transport else { return nil }
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
      let result = try await transport.request(
        .githubCreatePullRequest,
        Params(session_id: sessionId, title: title, body: body, draft: draft),
        as: Result.self)
      await refresh()

      return result.url
    } catch {
      self.error = "Couldn't open that pull request — \(AppStore.describe(error))"

      return nil
    }
  }

  @discardableResult
  func merge(repo: String, number: Int, strategy: RemoteMergeStrategy) async -> Bool {
    guard let transport = app.transport else { return false }
    struct Params: Encodable {
      let repo: String
      let number: Int
      let strategy: String
    }
    do {
      try await transport.request(
        .githubMergePullRequest,
        Params(repo: repo, number: number, strategy: strategy.rawValue),
        as: IgnoredResult.self)
      await loadDetail(repo: repo, number: number)
      await refresh()

      return true
    } catch {
      self.error = "Couldn't merge that pull request — \(AppStore.describe(error))"

      return false
    }
  }

  @discardableResult
  func comment(repo: String, number: Int, body: String) async -> Bool {
    guard let transport = app.transport else { return false }
    struct Params: Encodable {
      let repo: String
      let number: Int
      let body: String
    }
    do {
      try await transport.request(
        .githubCommentPullRequest, Params(repo: repo, number: number, body: body),
        as: IgnoredResult.self)
      await loadDetail(repo: repo, number: number)

      return true
    } catch {
      self.error = "Couldn't post that comment — \(AppStore.describe(error))"

      return false
    }
  }
}
