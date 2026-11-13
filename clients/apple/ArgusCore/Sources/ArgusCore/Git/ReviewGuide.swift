import ArgusKit
import Foundation
import Observation

public typealias ReviewGuideState = ArgusProtocol.RemoteReviewGuideState
public typealias ReviewGuideStop = ArgusProtocol.RemoteReviewGuideStop

/// What a review guide tours: a session's branch and uncommitted work, or a pull request.
public enum ReviewGuideTarget: Hashable, Sendable {
  case session(id: String)
  /// `repo` is `owner/repo`; `headSha` is the head the client last saw, so a stale guide says so.
  case pullRequest(repo: String, number: Int, headSha: String?)

  /// Where the guide's state and its draft comments are kept: a session's drafts are its review.
  public var key: String {
    switch self {
    case .session(let id): id
    case .pullRequest(let repo, let number, _): "pr:\(repo)#\(number)"
    }
  }

  public var sessionId: String? {
    if case .session(let id) = self { return id }
    return nil
  }

  /// What the drafts say they're about, as the agent prompt names it.
  public var scope: String {
    switch self {
    case .session: "changes on this branch"
    case .pullRequest(_, let number, _): "pull request #\(number)"
    }
  }

  var params: (sessionId: String?, repo: String?, number: Int?, headSha: String?) {
    switch self {
    case .session(let id): (id, nil, nil, nil)
    case .pullRequest(let repo, let number, let sha): (nil, repo, number, sha)
    }
  }
}

/// Each target's guide as the host last described it, the diff it was written against,
/// the stops you've looked at, and the answers to your questions. In memory: a review is one sitting.
@MainActor
@Observable
public final class ReviewGuides {
  public internal(set) var states: [String: ReviewGuideState] = [:]
  /// Each target's patch, parsed once per guide.
  public internal(set) var files: [String: [DiffFile]] = [:]
  public internal(set) var visited: [String: Set<String>] = [:]
  /// Answers by `key/stopId`, newest last.
  public internal(set) var answers: [String: [ReviewGuideAnswer]] = [:]
  public internal(set) var asking: Set<String> = []
  public internal(set) var errors: [String: String] = [:]

  public init() {}

  public func state(_ target: ReviewGuideTarget) -> ReviewGuideState? { states[target.key] }

  public func visited(_ target: ReviewGuideTarget) -> Set<String> { visited[target.key] ?? [] }

  public func answers(_ target: ReviewGuideTarget, stop: String) -> [ReviewGuideAnswer] {
    answers["\(target.key)/\(stop)"] ?? []
  }

  public func isAsking(_ target: ReviewGuideTarget, stop: String) -> Bool { asking.contains("\(target.key)/\(stop)") }

  /// The stop's files from the guide's patch, each cut down to the hunks the stop points at
  /// (every hunk when it points at none, as mechanical stops do).
  public func files(_ target: ReviewGuideTarget, stop: ReviewGuideStop) -> [DiffFile] {
    let all = files[target.key] ?? []
    return stop.paths.compactMap { path in
      guard var file = all.first(where: { $0.displayPath == path }) else { return nil }
      let ranges = stop.ranges.filter { $0.path == path }
      guard !ranges.isEmpty else { return file }
      let hunks = file.hunks.filter { hunk in ranges.contains { ReviewGuides.hunk(hunk, overlaps: $0) } }
      if !hunks.isEmpty { file.hunks = hunks }
      return file
    }
  }

  static func hunk(_ hunk: DiffHunk, overlaps range: ArgusProtocol.RemoteReviewGuideRange) -> Bool {
    let numbers = hunk.lines.compactMap { range.side == .old ? $0.oldNumber : $0.newNumber }
    guard let low = numbers.min(), let high = numbers.max() else { return false }
    return low <= Int(range.end) && Int(range.start) <= high
  }

  func set(_ state: ReviewGuideState, for key: String) {
    if states[key]?.guide?.headSha != state.guide?.headSha || files[key] == nil {
      files[key] = state.patch.map(DiffParser.parse) ?? []
    }
    states[key] = state
    errors[key] = nil
  }
}

public struct ReviewGuideAnswer: Identifiable, Hashable, Sendable {
  public let id = UUID()
  public let question: String
  public let answer: String
}

extension HostStore {
  /// The target's guide as it stands; keeps polling while one is being written.
  public func loadReviewGuide(_ target: ReviewGuideTarget) async {
    guard let backend else { return }
    let p = target.params
    do {
      let state = try await backend.request(
        ArgusProtocol.Methods.ReviewGuidesGet.self,
        .init(sessionId: p.sessionId, repo: p.repo, number: p.number, headSha: p.headSha)
      ).guide
      reviewGuides.set(state, for: target.key)
    } catch where !HostStore.isQuiet(error) {
      reviewGuides.errors[target.key] = HostStore.describe(error)
    } catch {}
  }

  /// Starts writing a guide; `force` rewrites one that already matches the head.
  public func generateReviewGuide(_ target: ReviewGuideTarget, force: Bool = false) async {
    guard let backend else { return }
    let p = target.params
    do {
      let state = try await backend.request(
        ArgusProtocol.Methods.ReviewGuidesGenerate.self,
        .init(sessionId: p.sessionId, repo: p.repo, number: p.number, headSha: p.headSha, force: force)
      ).guide
      reviewGuides.set(state, for: target.key)
      if force { reviewGuides.visited[target.key] = nil }
    } catch {
      reviewGuides.errors[target.key] = HostStore.describe(error)
      report(error, scope: "review_guide")
    }
  }

  public func markStopVisited(_ target: ReviewGuideTarget, stop: String) {
    guard !reviewGuides.visited(target).contains(stop) else { return }
    reviewGuides.visited[target.key, default: []].insert(stop)
    let count = reviewGuides.state(target)?.guide?.stops.count ?? 0
    if count > 0, reviewGuides.visited(target).count == count {
      hooks.track(.reviewGuideUsed(action: .completed, stops: count))
    }
  }

  /// Counted once per guide shown, not per poll.
  public func trackReviewGuideOpened(_ target: ReviewGuideTarget) {
    hooks.track(.reviewGuideUsed(action: .open, stops: reviewGuides.state(target)?.guide?.stops.count ?? 0))
  }

  public func askAboutStop(_ target: ReviewGuideTarget, stop: String, question: String) async {
    guard let backend else { return }
    let key = "\(target.key)/\(stop)"
    let p = target.params
    reviewGuides.asking.insert(key)
    defer { reviewGuides.asking.remove(key) }
    do {
      let answer = try await backend.request(
        ArgusProtocol.Methods.ReviewGuidesAsk.self,
        .init(sessionId: p.sessionId, repo: p.repo, number: p.number, headSha: p.headSha, stopId: stop, question: question)
      ).answer
      reviewGuides.answers[key, default: []].append(ReviewGuideAnswer(question: question, answer: answer))
      reviewGuides.errors[target.key] = nil
    } catch {
      reviewGuides.errors[target.key] = HostStore.describe(error)
      report(error, scope: "review_guide")
    }
  }

  /// Posts a pull request's drafts as one review on its code host, then clears them. False when it failed.
  public func submitPullRequestReview(
    repo: String, number: Int, event: ArgusProtocol.MethodsTypes.GithubReviewPullRequestParamsEvent, body: String
  ) async -> Bool {
    guard let backend else { return false }
    let key = ReviewGuideTarget.pullRequest(repo: repo, number: number, headSha: nil).key
    let comments = reviews.comments(key).map(PullRequestReviewComments.wire)
    do {
      try await backend.request(
        ArgusProtocol.Methods.GithubReviewPullRequest.self,
        .init(repo: repo, number: number, event: event, body: body, comments: comments))
      // The host counts the post; nothing to track here.
      reviews.clear(key)
      return true
    } catch {
      reviewGuides.errors[key] = HostStore.describe(error)
      report(error, scope: "review_guide")
      return false
    }
  }
}

public enum PullRequestReviewComments {
  /// A draft as an inline review comment: removed lines sit on the left side.
  public static func wire(_ comment: DiffReviewComment) -> ArgusProtocol.RemotePullRequestReviewComment {
    ArgusProtocol.RemotePullRequestReviewComment(
      path: comment.path, side: comment.side == .old ? .lEFT : .rIGHT, line: comment.lines.upperBound,
      startLine: comment.lines.count > 1 ? comment.lines.lowerBound : nil, body: comment.body)
  }
}
