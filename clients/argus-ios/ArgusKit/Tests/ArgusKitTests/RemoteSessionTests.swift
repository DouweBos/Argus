import Foundation
import Testing

@testable import ArgusKit

/// The computer sends `availability` only on newer builds, so the absent case
/// has to read as available — otherwise every session on an older computer
/// would render as if its drive had been pulled.
@Suite("RemoteSession availability")
struct RemoteSessionTests {

  private func decode(_ json: String) throws -> RemoteSession {
    try JSONDecoder().decode(RemoteSession.self, from: Data(json.utf8))
  }

  @Test("an older computer's session is available")
  func absent() throws {
    let session = try decode(
      """
      {"id":"s1","repo_root":"/r","kind":"worktree","branch":"feat","status":"ready"}
      """)

    #expect(session.availability == nil)
    #expect(!session.isUnavailable)
    #expect(session.volume == nil)
  }

  @Test("a connected session on an external drive names the drive")
  func external() throws {
    let session = try decode(
      """
      {"id":"s1","repo_root":"/r","kind":"worktree","branch":"feat","status":"ready",
       "availability":"available","volume":"Blackbox"}
      """)

    #expect(!session.isUnavailable)
    #expect(session.volume == "Blackbox")
  }

  @Test("a session on a disconnected drive names the drive")
  func unavailable() throws {
    let session = try decode(
      """
      {"id":"s1","repo_root":"/r","kind":"worktree","branch":"feat","status":"ready",
       "availability":"unavailable","unavailable_volume":"Blackbox"}
      """)

    #expect(session.isUnavailable)
    #expect(session.unavailableVolume == "Blackbox")
    // Still "ready": the session is fine, the drive is what is missing.
    #expect(session.status == .ready)
  }
}
