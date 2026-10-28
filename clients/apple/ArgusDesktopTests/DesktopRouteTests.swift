import ArgusCore
import Foundation
import Testing

@testable import Argus

struct DesktopRouteTests {
  @Test(arguments: [
    ("/", DesktopRoute.home),
    ("/agents", .agents),
    ("/runtimes", .runtimes),
    ("/devices", .devices),
    ("/devices/ios/ABC-123", .device(platform: "ios", deviceKey: "ABC-123")),
    ("/devices/android/emulator-5554", .device(platform: "android", deviceKey: "emulator-5554")),
    ("/devices/android/avd%3APixel_9", .device(platform: "android", deviceKey: "avd:Pixel_9")),
    ("/inbox", .inbox),
    ("/inbox/proposals/p1", .proposal(id: "p1")),
    ("/notifications", .notifications),
    ("/usage", .usage(.limits)),
    ("/usage/cost", .usage(.cost)),
    ("/usage/tokens", .usage(.tokens)),
    ("/usage/nonsense", .usage(.limits)),
    ("/usage/cost?range=7d", .usage(.cost, range: ._7d)),
    ("/usage/tokens?range=30d", .usage(.tokens)),
    ("/usage/tokens?range=1y", .usage(.tokens)),
    ("/usage?range=7d", .usage(.limits)),
    ("/pull-requests", .pullRequests),
    ("/issues", .issues),
    ("/pull-requests/houwert/argus/42", .pullRequest(repo: "houwert/argus", number: 42)),
    ("/automations", .automations),
    ("/automations/quick", .quickRun(runId: nil)),
    ("/automations/quick/runs/r1", .quickRun(runId: "r1")),
    ("/automations/a1", .automation(id: "a1", runId: nil)),
    ("/automations/a1/runs/r1", .automation(id: "a1", runId: "r1")),
    // The session home is gone; old links open the session's agents.
    ("/sessions/s1", .session(id: "s1", agentId: nil)),
    ("/sessions/s1/home", .session(id: "s1", agentId: nil)),
    ("/sessions/s1/agents", .session(id: "s1", agentId: nil)),
    ("/sessions/s1/agents/a1", .session(id: "s1", agentId: "a1")),
  ])
  func parsesTopLevelRoutes(path: String, route: DesktopRoute) {
    #expect(DesktopRoute(path: path) == route)
  }

  @Test(arguments: [
    ("/sessions/s1/git", GitRoute.working),
    ("/sessions/s1/git/working", .working),
    ("/sessions/s1/git/branch", .branch),
    ("/sessions/s1/git/history", .history),
    ("/sessions/s1/git/stashes", .stashes),
    ("/sessions/s1/git/reflog", .reflog),
    ("/sessions/s1/git/conflicts", .conflicts),
    ("/sessions/s1/git/branches", .branches(nil)),
    ("/sessions/s1/git/branches/main", .branches("main")),
    ("/sessions/s1/git/branches/feature%2Ffoo", .branches("feature/foo")),
    ("/sessions/s1/git/branches/feature/foo", .branches("feature/foo")),
    ("/sessions/s1/git/tags/v1.0", .tags("v1.0")),
    ("/sessions/s1/git/tags", .history),
    ("/sessions/s1/git/submodules", .submodules),
    ("/sessions/s1/git/bisect", .bisect),
    ("/sessions/s1/git/hooks", .hooks),
    ("/sessions/s1/git/compare?left=main&right=feature%2Fx", .compare(left: "main", right: "feature/x")),
    ("/sessions/s1/git/compare", .compare(left: "", right: "")),
    ("/sessions/s1/git/blame?path=src/a%20b.ts&ref=HEAD~1", .blame(path: "src/a b.ts", ref: "HEAD~1")),
    ("/sessions/s1/git/blame?path=README.md", .blame(path: "README.md", ref: nil)),
    ("/sessions/s1/git/blame", .blame(path: nil, ref: nil)),
    ("/sessions/s1/git/settings", .settings),
    ("/sessions/s1/git/pull-requests", .pullRequests),
    ("/sessions/s1/git/branches-review", .branchesReview),
    ("/sessions/s1/git/interactive-rebase?from=abc123", .interactiveRebase(from: "abc123")),
  ])
  func parsesGitRoutes(path: String, view: GitRoute) {
    #expect(DesktopRoute(path: path) == .sessionGit(id: "s1", view: view))
  }

  @Test(arguments: [
    "/nope", "/sessions", "/sessions/s1/git/nope", "/devices/ios", "/devices/ios/a/b", "/pull-requests/a/b/notanumber", "/agents/extra",
  ])
  func rejectsUnknownPaths(path: String) {
    #expect(DesktopRoute(path: path) == nil)
  }

  @Test(arguments: [
    DesktopRoute.home, .agents, .runtimes, .devices, .device(platform: "android", deviceKey: "avd:P 9"), .inbox, .proposal(id: "p 1"), .notifications, .usage(.limits), .usage(.cost), .usage(.tokens, range: ._90d),
    .pullRequests, .pullRequest(repo: "o/r", number: 7), .issues, .automations, .quickRun(runId: nil),
    .quickRun(runId: "r"), .automation(id: "a", runId: nil), .automation(id: "a", runId: "r"),
    .session(id: "s", agentId: nil), .session(id: "s", agentId: "a"),
    .sessionGit(id: "s", view: .working), .sessionGit(id: "s", view: .branches(nil)),
    .sessionGit(id: "s", view: .branches("feature/a b")), .sessionGit(id: "s", view: .tags("v1+2")),
    .sessionGit(id: "s", view: .compare(left: "a&b", right: "c=d")),
    .sessionGit(id: "s", view: .blame(path: "dir/f?.swift", ref: "HEAD")),
    .sessionGit(id: "s", view: .blame(path: nil, ref: nil)),
    .sessionGit(id: "s", view: .interactiveRebase(from: "abc")),
    .sessionGit(id: "s", view: .branchesReview),
  ])
  func pathsRoundTrip(route: DesktopRoute) {
    #expect(DesktopRoute(path: route.path) == route, "\(route.path)")
  }

  @Test func usageTabsAreTheirOwnPatterns() {
    #expect(DesktopRoute.usage(.limits).pattern == "/usage")
    #expect(DesktopRoute.usage(.cost).pattern == "/usage/cost")
    #expect(DesktopRoute.usage(.tokens).path == "/usage/tokens")
    #expect(DesktopRoute.usage(.cost, range: ._24h).path == "/usage/cost?range=24h")
    #expect(DesktopRoute.usage(.cost, range: ._24h).pattern == "/usage/cost")
  }

  @Test func deepLinksReadTheHostAsThePathsFirstSegment() {
    let url = URL(string: "argus://sessions/s1/git/compare?left=main&right=dev&host=mini")!
    #expect(DesktopRoute(deepLink: url) == .sessionGit(id: "s1", view: .compare(left: "main", right: "dev")))
    #expect(DesktopLocation(deepLink: url)?.host == "mini")
    #expect(DesktopRoute(deepLink: URL(string: "https://sessions/s1")!) == nil)
  }

  @Test func locationsCarryTheFocusedHost() {
    let remote = DesktopLocation(path: "/sessions/s1/agents?host=box")
    #expect(remote == DesktopLocation(route: .session(id: "s1", agentId: nil), host: "box"))
    #expect(DesktopLocation(path: "/agents")?.host == nil)
    #expect(DesktopLocation(path: "/agents?host=")?.host == nil)
    #expect(DesktopLocation(route: .agents, host: "local").host == nil)
    #expect(DesktopLocation(route: .agents, host: "box").path == "/agents?host=box")
    let git = DesktopLocation(route: .sessionGit(id: "s", view: .compare(left: "a", right: "b")), host: "box")
    #expect(git.path == "/sessions/s/git/compare?left=a&right=b&host=box")
    #expect(DesktopLocation(path: git.path) == git)
  }

  @Test func patternsNeverCarryIds() {
    #expect(DesktopRoute.sessionGit(id: "secret", view: .branches("secret-branch")).pattern
      == "/sessions/:sessionId/git/branches/:branchName")
    #expect(DesktopRoute.sessionGit(id: "s", view: .blame(path: "secret.txt", ref: nil)).pattern
      == "/sessions/:sessionId/git/blame")
  }

  @Test func aDeviceRouteIsTheDevicesScreenWithAPattern() {
    let route = DesktopRoute.device(platform: "ios", deviceKey: "U1")
    #expect(route.isDevices && DesktopRoute.devices.isDevices && !DesktopRoute.agents.isDevices)
    #expect(route.pattern == "/devices/:platform/:deviceKey")
    #expect(DeviceRef(platform: "ios", deviceKey: "U1") == DeviceRef(platform: "ios", deviceKey: "U1"))
  }
}
