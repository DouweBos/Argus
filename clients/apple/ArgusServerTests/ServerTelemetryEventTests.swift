import Foundation
import Testing

@testable import Argus_Server

struct ServerTelemetryEventTests {
  @Test func hostEventsLeaveOutWhatDoesNotApply() {
    let started = ServerTelemetryEvent.host(stage: .started, restarts: 0, exitCode: nil, holder: nil, success: nil)
    #expect(started.name == "mac_server_host")
    #expect(Set(started.properties.keys) == ["stage", "restarts"])
    let handover = ServerTelemetryEvent.host(stage: .handover, restarts: nil, exitCode: nil, holder: .electron, success: true)
    #expect(handover.properties["holder"] as? String == "electron")
    #expect(handover.properties["success"] as? Bool == true)
  }
}
