package dev.houwert.argus.core.routing

import dev.houwert.argus.core.stores.InboxFilter

import dev.houwert.argus.core.usage.UsageTab
import dev.houwert.argus.core.routing.ArgusRoute.Automation
import dev.houwert.argus.core.routing.ArgusRoute.Blueprint
import dev.houwert.argus.core.routing.ArgusRoute.Design
import dev.houwert.argus.core.routing.ArgusRoute.Device
import dev.houwert.argus.core.routing.ArgusRoute.Inbox
import dev.houwert.argus.core.routing.ArgusRoute.Issues
import dev.houwert.argus.core.routing.ArgusRoute.NewProject
import dev.houwert.argus.core.routing.ArgusRoute.QuickRun
import dev.houwert.argus.core.routing.ArgusRoute.Session
import dev.houwert.argus.core.routing.ArgusRoute.SessionCode
import dev.houwert.argus.core.routing.ArgusRoute.SessionGit
import dev.houwert.argus.core.routing.ArgusRoute.Teammate
import dev.houwert.argus.core.routing.ArgusRoute.Usage
import dev.houwert.argus.core.routing.ArgusRoute.UsageModel
import dev.houwert.argus.kit.protocol.generated.LinearIssueScope
import dev.houwert.argus.kit.protocol.generated.UsageRange
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ArgusRouteTest {
  @Test
  fun parsesTopLevelRoutes() {
    val cases = listOf(
      "/" to ArgusRoute.Home,
      "/agents" to ArgusRoute.Agents,
      "/runtimes" to ArgusRoute.Runtimes,
      "/devices" to ArgusRoute.Devices,
      "/devices/ios/ABC-123" to Device("ios", "ABC-123"),
      "/devices/android/emulator-5554" to Device("android", "emulator-5554"),
      "/devices/android/avd%3APixel_9" to Device("android", "avd:Pixel_9"),
      "/inbox" to Inbox(),
      "/inbox?automation=a1&project=Argus" to Inbox(InboxFilter(automationId = "a1", project = "Argus")),
      "/inbox?project=" to Inbox(),
      "/inbox/proposals/p1" to ArgusRoute.Proposal("p1"),
      "/notifications" to ArgusRoute.Notifications,
      "/sessions/archived" to ArgusRoute.ArchivedSessions,
      "/usage" to Usage(UsageTab.Limits),
      "/usage/cost" to Usage(UsageTab.Cost),
      "/usage/tokens" to Usage(UsageTab.Tokens),
      "/usage/nonsense" to Usage(UsageTab.Limits),
      "/usage/cost?range=7d" to Usage(UsageTab.Cost, UsageRange._7d),
      "/usage/tokens?range=30d" to Usage(UsageTab.Tokens),
      "/usage/tokens?range=1y" to Usage(UsageTab.Tokens),
      "/usage?range=7d" to Usage(UsageTab.Limits),
      "/usage/prices" to ArgusRoute.UsagePrices,
      "/usage/models" to ArgusRoute.UsageModels,
      "/usage/models?range=7d" to ArgusRoute.UsageModels,
      "/usage/cost/models/codex/gpt-5.5" to UsageModel(UsageTab.Cost, "codex", "gpt-5.5"),
      "/usage/tokens/models/opencode/openrouter%2Fqwen?range=7d" to
        UsageModel(UsageTab.Tokens, "opencode", "openrouter/qwen", UsageRange._7d),
      "/pull-requests" to ArgusRoute.PullRequests,
      "/compare/g1" to ArgusRoute.CompareRun("g1"),
      "/issues" to Issues(),
      "/issues/created" to Issues(scope = LinearIssueScope.created),
      "/issues/ENG-1" to Issues(issue = "ENG-1"),
      "/issues/subscribed/ENG-1" to Issues(scope = LinearIssueScope.subscribed, issue = "ENG-1"),
      "/issues/search?q=RTN-9181" to Issues(query = "RTN-9181"),
      "/issues/search?q=%20login%20bug%20" to Issues(query = "login bug"),
      "/issues/search/RTN-9181?q=rtn" to Issues(issue = "RTN-9181", query = "rtn"),
      // A search without a term is the plain list.
      "/issues/search" to Issues(),
      "/issues/search/ENG-1?q=" to Issues(issue = "ENG-1"),
      "/design?url=https%3A%2F%2Ffigma.com%2Fdesign%2Fk%2FA%3Fnode-id%3D1-2" to
        Design("https://figma.com/design/k/A?node-id=1-2"),
      "/design?url=https%3A%2F%2Ffigma.com%2Fdesign%2Fk&session=s1" to Design("https://figma.com/design/k", "s1"),
      "/pull-requests/houwert/argus/42" to ArgusRoute.PullRequest("houwert/argus", 42),
      "/pull-requests/acme/web/app/12" to ArgusRoute.PullRequest("acme/web/app", 12),
      "/blueprints" to ArgusRoute.Blueprints,
      "/blueprints/new" to Blueprint(null),
      "/blueprints/generate" to ArgusRoute.GenerateBlueprint,
      "/blueprints/new-project" to NewProject(null),
      "/blueprints/new-project?blueprint=b1" to NewProject("b1"),
      "/blueprints/b1" to Blueprint("b1"),
      "/automations" to ArgusRoute.Automations,
      "/automations/quick" to QuickRun(null),
      "/automations/describe" to ArgusRoute.DescribeAutomation,
      "/automations/upcoming" to ArgusRoute.UpcomingRuns,
      "/automations/quick/runs/r1" to QuickRun("r1"),
      "/automations/a1" to Automation("a1"),
      "/automations/a1/runs/r1" to Automation("a1", "r1"),
      "/teammates" to ArgusRoute.Teammates,
      "/teammates/gallery" to ArgusRoute.TeammateGallery,
      "/teammates/t1" to Teammate("t1"),
      "/teammates/t1/threads/th1" to Teammate("t1", TeammatePage.Chat("th1")),
      "/teammates/t1/profile" to Teammate("t1", TeammatePage.Profile),
      "/teammates/t1/duties" to Teammate("t1", TeammatePage.Duties),
      "/teammates/t1/memory" to Teammate("t1", TeammatePage.Memory),
      // The session home is gone; old links open the session's agents.
      "/sessions/s1" to Session("s1"),
      "/sessions/s1/home" to Session("s1"),
      "/sessions/s1/agents" to Session("s1"),
      "/sessions/s1/agents/a1" to Session("s1", "a1"),
      "/sessions/s1/code?path=src/a.ts&line=12" to SessionCode("s1", "src/a.ts", 12),
      "/sessions/s1/code?line=12" to SessionCode("s1"),
    )
    for ((path, route) in cases) assertEquals(route, ArgusRoute.parse(path), path)
  }

  @Test
  fun parsesGitRoutes() {
    val cases = listOf(
      "/sessions/s1/git" to GitRoute.Working,
      "/sessions/s1/git/working" to GitRoute.Working,
      "/sessions/s1/git/branch" to GitRoute.Branch,
      "/sessions/s1/git/history" to GitRoute.History,
      "/sessions/s1/git/stashes" to GitRoute.Stashes,
      "/sessions/s1/git/reflog" to GitRoute.Reflog,
      "/sessions/s1/git/conflicts" to GitRoute.Conflicts,
      "/sessions/s1/git/branches" to GitRoute.Branches(null),
      "/sessions/s1/git/branches/main" to GitRoute.Branches("main"),
      "/sessions/s1/git/branches/feature%2Ffoo" to GitRoute.Branches("feature/foo"),
      "/sessions/s1/git/branches/feature/foo" to GitRoute.Branches("feature/foo"),
      "/sessions/s1/git/tags/v1.0" to GitRoute.Tags("v1.0"),
      "/sessions/s1/git/tags" to GitRoute.History,
      "/sessions/s1/git/submodules" to GitRoute.Submodules,
      "/sessions/s1/git/bisect" to GitRoute.Bisect,
      "/sessions/s1/git/hooks" to GitRoute.Hooks,
      "/sessions/s1/git/compare?left=main&right=feature%2Fx" to GitRoute.Compare("main", "feature/x"),
      "/sessions/s1/git/compare" to GitRoute.Compare("", ""),
      "/sessions/s1/git/blame?path=src/a%20b.ts&ref=HEAD~1" to GitRoute.Blame("src/a b.ts", "HEAD~1"),
      "/sessions/s1/git/blame?path=README.md" to GitRoute.Blame("README.md", null),
      "/sessions/s1/git/blame" to GitRoute.Blame(null, null),
      "/sessions/s1/git/settings" to GitRoute.Settings,
      "/sessions/s1/git/pull-requests" to GitRoute.PullRequests,
      "/sessions/s1/git/branches-review" to GitRoute.BranchesReview,
      "/sessions/s1/git/interactive-rebase?from=abc123" to GitRoute.InteractiveRebase("abc123"),
      "/sessions/s1/git/timeline" to GitRoute.Timeline(null),
      "/sessions/s1/git/timeline?turn=cp-1" to GitRoute.Timeline("cp-1"),
    )
    for ((path, view) in cases) assertEquals(SessionGit("s1", view), ArgusRoute.parse(path), path)
  }

  @Test
  fun rejectsUnknownPaths() {
    val paths = listOf(
      "/nope", "/sessions", "/sessions/s1/git/nope", "/devices/ios", "/devices/ios/a/b", "/pull-requests/a/b/notanumber",
      "/agents/extra", "/issues/created/ENG-1/extra", "/design", "/design?url=", "/design/extra?url=x",
      "/teammates/t1/nope", "/teammates/t1/threads", "/teammates/t1/nope/x", "/teammates/t1/threads/a/b",
    )
    for (path in paths) assertNull(ArgusRoute.parse(path), path)
  }

  @Test
  fun pathsRoundTrip() {
    val routes = listOf(
      ArgusRoute.Home, ArgusRoute.Agents, ArgusRoute.Runtimes, ArgusRoute.Devices, Device("android", "avd:P 9"),
      Inbox(), Inbox(InboxFilter("a 1", "My App")), ArgusRoute.Proposal("p 1"), ArgusRoute.Notifications,
      Usage(UsageTab.Limits), Usage(UsageTab.Cost), Usage(UsageTab.Tokens, UsageRange._90d),
      ArgusRoute.UsagePrices, ArgusRoute.UsageModels, UsageModel(UsageTab.Cost, "claude-code", "claude-opus-5-5"),
      UsageModel(UsageTab.Tokens, "opencode", "a/b c", UsageRange._24h),
      ArgusRoute.PullRequests, ArgusRoute.PullRequest("o/r", 7), ArgusRoute.PullRequestGuide("group/sub/proj", 12),
      ArgusRoute.CompareRun("g 1"), Issues(), Issues(scope = LinearIssueScope.created),
      Issues(issue = "ENG-1"), Issues(scope = LinearIssueScope.subscribed, issue = "ENG-1"),
      Issues(query = "a&b c"), Issues(issue = "ENG-1", query = "login?"), Issues(query = "c++ 1+1=2"),
      Design("https://www.figma.com/design/k/App?node-id=1-2&t=a+b"), Design("https://figma.com/file/k", "s 1"),
      ArgusRoute.Blueprints, Blueprint(null), Blueprint("b 1"), ArgusRoute.GenerateBlueprint,
      NewProject(null), NewProject("b&1"),
      ArgusRoute.Automations, QuickRun(null), ArgusRoute.DescribeAutomation, ArgusRoute.UpcomingRuns,
      QuickRun("r"), Automation("a"), Automation("a", "r"),
      ArgusRoute.Teammates, ArgusRoute.TeammateGallery, Teammate("t 1"), Teammate("t", TeammatePage.Chat("th/1")),
      Teammate("t", TeammatePage.Profile), Teammate("t", TeammatePage.Duties), Teammate("t", TeammatePage.Memory),
      Session("s"), Session("s", "a"), Session("s/1", "a#2"),
      SessionCode("s"), SessionCode("s", "dir/f ü.kt", 3), SessionCode("s", "a.kt"),
      SessionGit("s", GitRoute.Working), SessionGit("s", GitRoute.Branches(null)),
      SessionGit("s", GitRoute.Branches("feature/a b")), SessionGit("s", GitRoute.Tags("v1+2")),
      SessionGit("s", GitRoute.Compare("a&b", "c=d")),
      SessionGit("s", GitRoute.Blame("dir/f?.swift", "HEAD")),
      SessionGit("s", GitRoute.Blame(null, null)),
      SessionGit("s", GitRoute.InteractiveRebase("abc")),
      SessionGit("s", GitRoute.BranchesReview), SessionGit("s", GitRoute.Guide),
      SessionGit("s", GitRoute.Timeline(null)), SessionGit("s", GitRoute.Timeline("cp 1")),
    )
    for (route in routes) assertEquals(route, ArgusRoute.parse(route.path), route.path)
  }

  @Test
  fun teammatePatternsLeaveTheIdsOut() {
    assertEquals("/teammates/:teammateId", Teammate("t").pattern)
    assertEquals("/teammates/:teammateId/threads/:threadId", Teammate("t", TeammatePage.Chat("x")).pattern)
    assertEquals("/teammates/:teammateId/memory", Teammate("t", TeammatePage.Memory).pattern)
    assertEquals("/teammates/gallery", ArgusRoute.TeammateGallery.pattern)
  }

  @Test
  fun designPatternLeavesTheLinkOut() {
    assertEquals("/design", Design("https://figma.com/design/k", "s").pattern)
  }

  @Test
  fun usageTabsAreTheirOwnPatterns() {
    assertEquals("/usage", Usage(UsageTab.Limits).pattern)
    assertEquals("/usage/cost", Usage(UsageTab.Cost).pattern)
    assertEquals("/usage/tokens", Usage(UsageTab.Tokens).path)
    assertEquals("/issues/search?q=login%20bug", Issues(scope = LinearIssueScope.created, query = "login bug").path)
    assertEquals("/usage/cost?range=24h", Usage(UsageTab.Cost, UsageRange._24h).path)
    assertEquals("/usage/cost", Usage(UsageTab.Cost, UsageRange._24h).pattern)
    assertEquals("/usage/tokens/models/:runner/:model", UsageModel(UsageTab.Tokens, "codex", "m").pattern)
    assertEquals("/usage/prices", ArgusRoute.UsagePrices.pattern)
    assertEquals("/usage/models", ArgusRoute.UsageModels.pattern)
    // `models` is a tab's child only under cost or tokens, never a tab itself.
    assertNull(ArgusRoute.parse("/usage/models/codex/m"))
    assertEquals(UsageModel(UsageTab.Cost, "codex", "models"), ArgusRoute.parse("/usage/cost/models/codex/models"))
    assertNull(ArgusRoute.parse("/usage/limits/models/codex/m"))
  }

  @Test
  fun deepLinksReadTheHostAsThePathsFirstSegment() {
    val url = "argus://sessions/s1/git/compare?left=main&right=dev&host=mini"
    assertEquals(SessionGit("s1", GitRoute.Compare("main", "dev")), ArgusRoute.fromDeepLink(url))
    assertEquals("mini", ArgusLocation.fromDeepLink(url)?.host)
    assertNull(ArgusRoute.fromDeepLink("https://sessions/s1"))
    assertEquals(ArgusRoute.Agents, ArgusRoute.fromDeepLink("argus://agents#ignored"))
  }

  @Test
  fun locationsCarryTheFocusedHost() {
    val remote = ArgusLocation.parse("/sessions/s1/agents?host=box")
    assertEquals(ArgusLocation(Session("s1"), "box"), remote)
    assertNull(ArgusLocation.parse("/agents")?.host)
    assertNull(ArgusLocation.parse("/agents?host=")?.host)
    assertNull(ArgusLocation(ArgusRoute.Agents, "local").host)
    assertEquals("/agents?host=box", ArgusLocation(ArgusRoute.Agents, "box").path)
    val git = ArgusLocation(SessionGit("s", GitRoute.Compare("a", "b")), "box")
    assertEquals("/sessions/s/git/compare?left=a&right=b&host=box", git.path)
    assertEquals(git, ArgusLocation.parse(git.path))
  }

  @Test
  fun patternsNeverCarryIds() {
    assertEquals(
      "/sessions/:sessionId/git/branches/:branchName",
      SessionGit("secret", GitRoute.Branches("secret-branch")).pattern,
    )
    assertEquals("/sessions/:sessionId/git/blame", SessionGit("s", GitRoute.Blame("secret.txt", null)).pattern)
    assertEquals("/issues/created/:issue", Issues(scope = LinearIssueScope.created, issue = "ENG-1").pattern)
    assertEquals("/issues", Issues().pattern)
    assertEquals("/issues/search", Issues(scope = LinearIssueScope.created, query = "secret").pattern)
    assertEquals("/issues/search/:issue", Issues(issue = "ENG-1", query = "secret").pattern)
  }

  @Test
  fun aDeviceRouteIsTheDevicesScreenWithAPattern() {
    val route = Device("ios", "U1")
    assertTrue(route.isDevices && ArgusRoute.Devices.isDevices && !ArgusRoute.Agents.isDevices)
    assertEquals("/devices/:platform/:deviceKey", route.pattern)
  }

  @Test
  fun routeAccessorsReadTheirCase() {
    assertEquals("s", Session("s", "a").sessionId)
    assertEquals("a", Session("s", "a").agentId)
    assertNull(Design("u", "s").sessionId)
    assertEquals(GitRoute.Guide, SessionGit("s", GitRoute.Guide).gitView)
    assertEquals(ArgusRoute.PullRequestDetail("o/r", 1, guide = true), ArgusRoute.PullRequestGuide("o/r", 1).pullRequestDetail)
    assertTrue(NewProject().isBlueprints)
    assertFalse(ArgusRoute.Automations.isBlueprints)
    assertTrue(GitRoute.Tags("v1").showsHistory && GitRoute.Tags("v1").isProjectScope)
    assertEquals("v1", GitRoute.Tags("v1").historyRef)
  }

  @Test
  fun aMalformedEscapeLeavesTheSegmentAsIsAndDropsTheQuery() {
    assertEquals(Session("a%zz"), ArgusRoute.parse("/sessions/a%zz/agents"))
    assertEquals(Inbox(), ArgusRoute.parse("/inbox?project=%zz"))
  }
}
