import Foundation
import Testing

@testable import ArgusKit

@Suite struct TransportErrorClassificationTests {
  /// The host gives each account's limits probe 20 s; the default would cut it off.
  @Test func planLimitsOutwaitTheHostProbe() {
    #expect(Transport.timeout(for: RemoteMethod.usageLimits.rawValue) == .seconds(30))
    #expect(Transport.timeout(for: "get_claude_usage_limits") == .seconds(30))
    #expect(Transport.timeout(for: "agents.list") == Transport.requestTimeout)
    #expect(Transport.timeout(for: "agents.list", requested: .seconds(60)) == .seconds(60))
    #expect(Transport.longestRequestTimeout == .seconds(30))
  }
}
