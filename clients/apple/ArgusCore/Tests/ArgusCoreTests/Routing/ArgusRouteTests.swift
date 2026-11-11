import ArgusCore
import ArgusKit
import Foundation
import Testing

struct ArgusRouteTests {
  @Test(arguments: [
    ("/", ArgusRoute.home),
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
    ("/usage/prices", .usagePrices),
    ("/usage/cost/models/codex/gpt-5.5", .usageModel(.cost, runner: "codex", model: "gpt-5.5")),
    ("/usage/tokens/models/opencode/openrouter%2Fqwen?range=7d", .usageModel(.tokens, runner: "opencode", model: "openrouter/qwen", range: ._7d)),
    ("/pull-requests", .pullRequests),
    ("/issues", .issues()),
    ("/issues/created", .issues(scope: .created)),
    ("/issues/ENG-1", .issues(issue: "ENG-1")),
    ("/issues/subscribed/ENG-1", .issues(scope: .subscribed, issue: "ENG-1")),
    ("/issues/search?q=RTN-9181", .issues(query: "RTN-9181")),
    ("/issues/search?q=%20login%20bug%20", .issues(query: "login bug")),
    ("/issues/search/RTN-9181?q=rtn", .issues(issue: "RTN-9181", query: "rtn")),
    // A search without a term is the plain list.
    ("/issues/search", .issues()),
    ("/issues/search/ENG-1?q=", .issues(issue: "ENG-1")),
    ("/design?url=https%3A%2F%2Ffigma.com%2Fdesign%2Fk%2FA%3Fnode-id%3D1-2", .design(url: "https://figma.com/design/k/A?node-id=1-2")),
    ("/design?url=https%3A%2F%2Ffigma.com%2Fdesign%2Fk&session=s1", .design(url: "https://figma.com/design/k", sessionId: "s1")),
    ("/pull-requests/houwert/argus/42", .pullRequest(repo: "houwert/argus", number: 42)),
    ("/automations", .automations),
    ("/automations/quick", .quickRun(runId: nil)),
    ("/automations/describe", .describeAutomation),
    ("/automations/quick/runs/r1", .quickRun(runId: "r1")),
    ("/automations/a1", .automation(id: "a1", runId: nil)),
    ("/automations/a1/runs/r1", .automation(id: "a1", runId: "r1")),
    // The session home is gone; old links open the session's agents.
    ("/sessions/s1", .session(id: "s1", agentId: nil)),
    ("/sessions/s1/home", .session(id: "s1", agentId: nil)),
    ("/sessions/s1/agents", .session(id: "s1", agentId: nil)),
    ("/sessions/s1/agents/a1", .session(id: "s1", agentId: "a1")),
  ])
  func parsesTopLevelRoutes(path: String, route: ArgusRoute) {
    #expect(ArgusRoute(path: path) == route)
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
    #expect(ArgusRoute(path: path) == .sessionGit(id: "s1", view: view))
  }

  @Test(arguments: [
    "/nope", "/sessions", "/sessions/s1/git/nope", "/devices/ios", "/devices/ios/a/b", "/pull-requests/a/b/notanumber", "/agents/extra",
    "/issues/created/ENG-1/extra", "/design", "/design?url=", "/design/extra?url=x",
  ])
  func rejectsUnknownPaths(path: String) {
    #expect(ArgusRoute(path: path) == nil)
  }

  @Test(arguments: [
    ArgusRoute.home, .agents, .runtimes, .devices, .device(platform: "android", deviceKey: "avd:P 9"), .inbox, .proposal(id: "p 1"), .notifications, .usage(.limits), .usage(.cost), .usage(.tokens, range: ._90d),
    .usagePrices, .usageModel(.cost, runner: "claude-code", model: "claude-opus-5-5"),
    .usageModel(.tokens, runner: "opencode", model: "a/b c", range: ._24h),
    .pullRequests, .pullRequest(repo: "o/r", number: 7), .issues(), .issues(scope: .created),
    .issues(issue: "ENG-1"), .issues(scope: .subscribed, issue: "ENG-1"),
    .issues(query: "a&b c"), .issues(issue: "ENG-1", query: "login?"),
    .design(url: "https://www.figma.com/design/k/App?node-id=1-2&t=a+b"), .design(url: "https://figma.com/file/k", sessionId: "s 1"),
    .automations, .quickRun(runId: nil), .describeAutomation,
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
  func pathsRoundTrip(route: ArgusRoute) {
    #expect(ArgusRoute(path: route.path) == route, "\(route.path)")
  }

  @Test func designPatternLeavesTheLinkOut() {
    #expect(ArgusRoute.design(url: "https://figma.com/design/k", sessionId: "s").pattern == "/design")
  }

  @Test func usageTabsAreTheirOwnPatterns() {
    #expect(ArgusRoute.usage(.limits).pattern == "/usage")
    #expect(ArgusRoute.usage(.cost).pattern == "/usage/cost")
    #expect(ArgusRoute.usage(.tokens).path == "/usage/tokens")
    #expect(ArgusRoute.issues(scope: .created, query: "login bug").path == "/issues/search?q=login%20bug")
    #expect(ArgusRoute.usage(.cost, range: ._24h).path == "/usage/cost?range=24h")
    #expect(ArgusRoute.usage(.cost, range: ._24h).pattern == "/usage/cost")
    #expect(ArgusRoute.usageModel(.tokens, runner: "codex", model: "m").pattern == "/usage/tokens/models/:runner/:model")
    #expect(ArgusRoute.usagePrices.pattern == "/usage/prices")
    #expect(ArgusRoute(path: "/usage/limits/models/codex/m") == nil)
  }

  @Test func deepLinksReadTheHostAsThePathsFirstSegment() {
    let url = URL(string: "argus://sessions/s1/git/compare?left=main&right=dev&host=mini")!
    #expect(ArgusRoute(deepLink: url) == .sessionGit(id: "s1", view: .compare(left: "main", right: "dev")))
    #expect(ArgusLocation(deepLink: url)?.host == "mini")
    #expect(ArgusRoute(deepLink: URL(string: "https://sessions/s1")!) == nil)
  }

  @Test func locationsCarryTheFocusedHost() {
    let remote = ArgusLocation(path: "/sessions/s1/agents?host=box")
    #expect(remote == ArgusLocation(route: .session(id: "s1", agentId: nil), host: "box"))
    #expect(ArgusLocation(path: "/agents")?.host == nil)
    #expect(ArgusLocation(path: "/agents?host=")?.host == nil)
    #expect(ArgusLocation(route: .agents, host: "local").host == nil)
    #expect(ArgusLocation(route: .agents, host: "box").path == "/agents?host=box")
    let git = ArgusLocation(route: .sessionGit(id: "s", view: .compare(left: "a", right: "b")), host: "box")
    #expect(git.path == "/sessions/s/git/compare?left=a&right=b&host=box")
    #expect(ArgusLocation(path: git.path) == git)
  }

  @Test func patternsNeverCarryIds() {
    #expect(ArgusRoute.sessionGit(id: "secret", view: .branches("secret-branch")).pattern
      == "/sessions/:sessionId/git/branches/:branchName")
    #expect(ArgusRoute.sessionGit(id: "s", view: .blame(path: "secret.txt", ref: nil)).pattern
      == "/sessions/:sessionId/git/blame")
    #expect(ArgusRoute.issues(scope: .created, issue: "ENG-1").pattern == "/issues/created/:issue")
    #expect(ArgusRoute.issues().pattern == "/issues")
    #expect(ArgusRoute.issues(scope: .created, query: "secret").pattern == "/issues/search")
    #expect(ArgusRoute.issues(issue: "ENG-1", query: "secret").pattern == "/issues/search/:issue")
  }

  @Test func aDeviceRouteIsTheDevicesScreenWithAPattern() {
    let route = ArgusRoute.device(platform: "ios", deviceKey: "U1")
    #expect(route.isDevices && ArgusRoute.devices.isDevices && !ArgusRoute.agents.isDevices)
    #expect(route.pattern == "/devices/:platform/:deviceKey")
  }
}
