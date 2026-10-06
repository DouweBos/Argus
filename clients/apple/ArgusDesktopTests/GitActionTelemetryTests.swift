import GroveKit
import Testing

@testable import Argus

struct GitActionTelemetryTests {
  /// A new GroveKit action has to get a `mac_git_used` name (and a line in the telemetry doc), or be listed here.
  @Test func everyGroveKitActionArgusRunsHasATelemetryName() {
    let noView: Set<GroveKitAction> = [.worktree, .restack, .stackFold, .stackRetarget, .gitFlow, .svn]
    let unmapped = GroveKitAction.allCases.filter { !noView.contains($0) && MacTelemetryEvent.GitAction($0) == nil }
    #expect(unmapped.isEmpty)
    #expect(MacTelemetryEvent.GitAction(.applyPatch) == .patchApply)
    #expect(MacTelemetryEvent.GitAction(.stageHunk) == .stageHunk)
  }
}
