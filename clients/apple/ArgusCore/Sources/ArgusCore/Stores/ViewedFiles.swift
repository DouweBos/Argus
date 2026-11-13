import ArgusKit
import Foundation
import Observation

/// Which files of one diff are ticked as viewed. A pull request's marks are
/// GitHub's own, so github.com shows the same progress; a session's are kept
/// on the computer. A mark reads `changed` once the file changed after it.
@MainActor
@Observable
public final class ViewedFiles {
  public enum Scope: Hashable, Sendable {
    case pullRequest(repo: String, number: Int)
    /// `mode` is `branch` (vs base) or `working` (uncommitted).
    case session(id: String, mode: String)
  }

  public typealias State = ArgusProtocol.RemoteViewedFileState

  public let scope: Scope
  public private(set) var states: [String: State] = [:]
  /// The last tick that didn't stick.
  public var error: String?

  private unowned let host: HostStore

  public init(scope: Scope, host: HostStore) {
    self.scope = scope
    self.host = host
  }

  public func state(_ path: String) -> State? { states[path] }
  public func isViewed(_ path: String) -> Bool { states[path] == .viewed }

  /// How many of `paths` are viewed and still as they were.
  public func viewedCount(_ paths: [String]) -> Int { paths.filter(isViewed).count }

  public func load() async {
    guard let backend = host.backend else { return }
    do {
      let files: [ArgusProtocol.RemoteViewedFile]
      switch scope {
      case .pullRequest(let repo, let number):
        files = try await backend.request(
          ArgusProtocol.Methods.GithubPullRequestViewedFiles.self, .init(repo: repo, number: number)
        ).files
      case .session(let id, let mode):
        files = try await backend.request(
          ArgusProtocol.Methods.SessionsViewedFiles.self, .init(sessionId: id, mode: .init(rawValue: mode))
        ).files
      }
      apply(files)
    } catch {
      // Marks are an aid: a computer without them, or `gh` signed out, shows none.
    }
  }

  public func toggle(_ path: String) async { await set(path, viewed: !isViewed(path)) }

  public func set(_ path: String, viewed: Bool) async {
    guard let backend = host.backend else { return }
    let before = states[path]
    states[path] = viewed ? .viewed : nil
    do {
      let files: [ArgusProtocol.RemoteViewedFile]
      switch scope {
      case .pullRequest(let repo, let number):
        files = try await backend.request(
          ArgusProtocol.Methods.GithubSetPullRequestFileViewed.self,
          .init(repo: repo, number: number, path: path, viewed: viewed)
        ).files
      case .session(let id, let mode):
        files = try await backend.request(
          ArgusProtocol.Methods.SessionsSetFileViewed.self,
          .init(sessionId: id, mode: .init(rawValue: mode), path: path, viewed: viewed)
        ).files
      }
      apply(files)
      error = nil
    } catch {
      states[path] = before
      guard !HostStore.isQuiet(error) else { return }
      self.error = "Couldn't mark that file — \(HostStore.describe(error))"
      host.hooks.errorReported(error, "viewed_files")
    }
  }

  private func apply(_ files: [ArgusProtocol.RemoteViewedFile]) {
    states = Dictionary(files.map { ($0.path, $0.state) }, uniquingKeysWith: { _, last in last })
  }
}
