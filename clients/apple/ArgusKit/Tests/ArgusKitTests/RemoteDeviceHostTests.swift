import Foundation
import Testing

@testable import ArgusKit

/// Computers that predate EAS hosts send no `kind`, so an absent one has to
/// read as an SSH host with no session counts.
@Suite("RemoteDeviceHost kinds")
struct RemoteDeviceHostTests {

  private func decode(_ json: String) throws -> RemoteDeviceHost {
    try JSONDecoder().decode(RemoteDeviceHost.self, from: Data(json.utf8))
  }

  @Test("an older computer's host is an SSH host")
  func absent() throws {
    let host = try decode(#"{"id":"rh0a1b2c3d","label":"studio","status":"connected"}"#)

    #expect(!host.isEas)
    #expect(host.runningSessions == nil)
  }

  @Test("an EAS host carries its running sessions and limit")
  func eas() throws {
    let host = try decode(
      """
      {"id":"eh0a1b2c3d","label":"Cloud","status":"unknown","kind":"eas","running_sessions":1,"max_sessions":2}
      """)

    #expect(host.isEas)
    #expect(host.runningSessions == 1)
    #expect(host.maxSessions == 2)
  }
}
