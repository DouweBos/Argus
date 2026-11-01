import Foundation
import Testing

@testable import ArgusKit

@Suite struct TransportErrorClassificationTests {
  @Test func connectionFailuresAreTransient() {
    #expect(Transport.TransportError.notReady.isTransient)
    #expect(Transport.TransportError.timedOut.isTransient)
  }

  @Test func requestFailuresAreNot() {
    let payload = GatewayErrorPayload(code: "bad_request", message: "nope")
    #expect(!Transport.TransportError.gateway(payload).isTransient)
    #expect(!Transport.TransportError.badIdentity.isTransient)
    #expect(!Transport.TransportError.unsupported(method: "x", hostVersion: nil).isTransient)
  }

  /// The host gives each account's limits probe 20 s; the default would cut it off.
  @Test func planLimitsOutwaitTheHostProbe() {
    #expect(Transport.timeout(for: RemoteMethod.usageLimits.rawValue) == .seconds(30))
    #expect(Transport.timeout(for: "get_claude_usage_limits") == .seconds(30))
    #expect(Transport.timeout(for: "agents.list") == Transport.requestTimeout)
    #expect(Transport.timeout(for: "agents.list", requested: .seconds(60)) == .seconds(60))
    #expect(Transport.longestRequestTimeout == .seconds(30))
  }
}
