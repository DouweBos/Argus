import ArgusKit
import Foundation

extension HostStore {
  /// Tell the host which session this client shows, nil for none, so it keeps
  /// a warm agent there and the next start there is instant. `runnerId` is a
  /// start composer's runner pick.
  /// Returns a token for `stopViewing`, so a screen only clears what it set.
  @discardableResult
  public func reportViewing(sessionId: String?, runnerId: String? = nil) async -> Int {
    viewingToken += 1
    let token = viewingToken
    viewingSessionId = sessionId
    viewingRunnerId = sessionId == nil ? nil : runnerId
    await sendViewing()
    return token
  }

  /// A screen that said what it shows is going away: put back `restoring`
  /// (nil for nothing), unless another screen has spoken since.
  public func stopViewing(token: Int, restoring: String? = nil) async {
    guard token == viewingToken else { return }
    await reportViewing(sessionId: restoring)
  }

  func sendViewing() async {
    guard let backend else { return }
    struct Params: Encodable {
      let session_id: String?
      let runner_id: String?
    }
    _ = try? await backend.request(
      .sessionsViewing, Params(session_id: viewingSessionId, runner_id: viewingRunnerId),
      as: IgnoredResult.self)
  }

  /// Slash commands and models for a start composer: the session's warm agent's
  /// when it has one, else the last ones that runner reported.
  public func loadStartOptions(sessionId: String, runnerId: String? = nil) async {
    guard let backend else { return }
    struct Params: Encodable {
      let session_id: String
      let runner_id: String?
    }
    struct Result: Decodable { let capabilities: RemoteAgentCapabilities }
    guard
      let result = try? await backend.request(
        .sessionsStartOptions, Params(session_id: sessionId, runner_id: runnerId), as: Result.self)
    else { return }
    startOptionsBySession[sessionId] = result.capabilities
  }
}
