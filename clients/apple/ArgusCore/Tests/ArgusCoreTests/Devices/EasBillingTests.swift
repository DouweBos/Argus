import ArgusCore
import Testing

@Suite("EAS billing")
struct EasBillingTests {
  @Test("only a stopped EAS slot is a billable start")
  func billable() {
    #expect(EasBilling.isBillableStart(deviceId: "eas:eh0123abcd:1", running: false))
    #expect(!EasBilling.isBillableStart(deviceId: "eas:eh0123abcd:1", running: true))
    #expect(!EasBilling.isBillableStart(deviceId: "A1B2-C3D4", running: false))
    #expect(EasBilling.hostId(of: "eas:eh0123abcd:12") == "eh0123abcd")
    #expect(EasBilling.hostId(of: "eas:eh0123abcd") == nil)
  }

  @Test("names the host's limits when known")
  func message() {
    #expect(
      EasBilling.startMessage(idleMinutes: 10, maxSessionMinutes: 30)
        .contains("idle for 10 min, or it reaches its 30 min limit"))
    #expect(EasBilling.startMessage(idleMinutes: nil, maxSessionMinutes: nil).contains("time limit"))
  }
}
