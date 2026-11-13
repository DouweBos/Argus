import ArgusCore
import ArgusUI
import SwiftUI

extension EnvironmentValues {
  /// Where a screen's own pushes land, when not the router's stack: the iPad
  /// side panel keeps a stack of its own.
  @Entry var stackPush: (@MainActor (Route) -> Void)? = nil
}

/// What a screen in the side panel puts in the panel's header, which stands in
/// for the navigation bar it doesn't have there.
struct PanelBar {
  var principal: AnyView?
  var trailing: AnyView?
}

struct PanelBarKey: SwiftUI.PreferenceKey {
  static var defaultValue: PanelBar { PanelBar() }
  static func reduce(value: inout PanelBar, nextValue: () -> PanelBar) {
    let next = nextValue()
    if let principal = next.principal { value.principal = principal }
    if let trailing = next.trailing { value.trailing = trailing }
  }
}

extension View {
  /// Navigation bar items: in the bar, or in the side panel's header. A
  /// `.toolbar` from inside the panel would land in the session's own bar.
  func screenBar(@ViewBuilder trailing: () -> some View) -> some View {
    modifier(ScreenBar(principal: Optional<EmptyView>.none, trailing: trailing()))
  }

  func screenBar(@ViewBuilder principal: () -> some View, @ViewBuilder trailing: () -> some View) -> some View {
    modifier(ScreenBar(principal: principal(), trailing: trailing()))
  }

  /// A search field: the bar's drawer, or above the content in the side panel.
  func screenSearch(text: Binding<String>, prompt: String) -> some View {
    modifier(ScreenSearch(text: text, prompt: prompt))
  }
}

private struct ScreenBar<Principal: View, Trailing: View>: ViewModifier {
  @Environment(\.stackPush) private var stackPush
  let principal: Principal?
  let trailing: Trailing

  func body(content: Content) -> some View {
    if stackPush != nil {
      content.preference(
        key: PanelBarKey.self, value: PanelBar(principal: principal.map { AnyView($0) }, trailing: AnyView(trailing)))
    } else {
      content.toolbar {
        if let principal { ToolbarItem(placement: .principal) { principal } }
        ToolbarItem(placement: .topBarTrailing) { trailing }
      }
    }
  }
}

private struct ScreenSearch: ViewModifier {
  @Environment(\.theme) private var theme
  @Environment(\.stackPush) private var stackPush
  @Binding var text: String
  let prompt: String

  func body(content: Content) -> some View {
    if stackPush != nil {
      content.safeAreaInset(edge: .top, spacing: 0) {
        HStack(spacing: 6) {
          Image(systemName: Icon.search).foregroundStyle(theme.textMuted)
          TextField(prompt, text: $text)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(theme.bgTertiary, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .padding(.horizontal, theme.space)
        .padding(.vertical, 8)
        .background(theme.bg)
      }
    } else {
      content.searchable(text: $text, placement: .navigationBarDrawer(displayMode: .always), prompt: prompt)
    }
  }
}

/// A link onto the stack its screen is on: a `NavigationLink` on the router's
/// stacks, a button onto the side panel's, which no `NavigationLink` can reach.
struct StackLink<Label: View>: View {
  @Environment(\.theme) private var theme
  @Environment(\.stackPush) private var stackPush
  let route: Route
  /// Drawn by hand off the router's stacks, where a list would have drawn it.
  var chevron = true
  @ViewBuilder let label: Label

  var body: some View {
    if let stackPush {
      Button {
        stackPush(route)
      } label: {
        HStack(spacing: 8) {
          label.frame(maxWidth: .infinity, alignment: .leading)
          if chevron {
            Image(systemName: Icon.chevronRight)
              .font(.scaled(.footnote).weight(.semibold))
              .foregroundStyle(theme.textMuted)
              .accessibilityHidden(true)
          }
        }
        .contentShape(.rect)
      }
      .buttonStyle(.argusPlain)
    } else {
      NavigationLink(value: route) { label }
    }
  }
}

/// The screen for a route, wherever it is pushed: a tab, the detail column or
/// the iPad side panel.
struct RouteScreen: View {
  @Environment(Router.self) private var router
  @Environment(\.stackPush) private var stackPush
  let route: Route

  var body: some View {
    // Every push funnels through here, so this is the one place a screen
    // event has to be sent from.
    screen.onAppear { Telemetry.screen(route) }
  }

  private func push(_ route: Route) { (stackPush ?? router.push)(route) }

  @ViewBuilder private var screen: some View {
    switch route {
    case .pair:
      PairView()
    case .computer(let deviceId):
      ComputerView(deviceId: deviceId)
    case .projects:
      ProjectsView()
    case .agents:
      AllAgentsView()
    case .project(let repoRoot, let name):
      ProjectView(repoRoot: repoRoot, name: name)
    case .newSession(let repoRoot):
      NewSessionView(repoRoot: repoRoot)
    case .session(let id, let label, let repoRoot):
      SessionView(sessionId: id, label: label, repoRoot: repoRoot)
    case .compareRun(let groupId):
      CompareRunScreen(groupId: groupId).id(groupId)
    case .agent(let id, let label):
      SessionView(sessionId: nil, label: label, agentId: id)
    case .stoppedAgent(let historyId, let repoRoot, let label, let branch, let runner):
      StoppedAgentView(
        historyId: historyId, repoRoot: repoRoot, label: label,
        branch: branch, runnerSessionId: runner)
    case .changes(let sessionId, let label):
      ChangesView(sessionId: sessionId, label: label)
    case .fileDiff(let sessionId, let path, let mode):
      FileDiffView(sessionId: sessionId, path: path, mode: mode)
    case .file(let sessionId, let path, let line, let source):
      FileView(sessionId: sessionId, path: path, line: line, source: source)
    case .quickOpen(let sessionId, let label):
      QuickOpenView(sessionId: sessionId, label: label)
    case .fileSearch(let sessionId, let label):
      FileSearchView(sessionId: sessionId, label: label)
    case .terminals(let sessionId, let label):
      SessionTerminalsList(sessionId: sessionId) { terminal in
        push(.terminal(id: terminal.id, label: SessionTerminalsList.title(terminal)))
      }
      .navigationTitle("Terminals · \(label)")
      .navigationBarTitleDisplayMode(.inline)
    case .terminal(let id, let label):
      TerminalOutputView(terminalId: id)
        .navigationTitle(label)
        .navigationBarTitleDisplayMode(.inline)
    case .mcpServers(let agentId):
      McpServersScreen(agentId: agentId)
    case .stashes(let sessionId, let label):
      StashesView(sessionId: sessionId, label: label)
    case .branches(let sessionId, let repoRoot, let label):
      BranchesView(sessionId: sessionId, repoRoot: repoRoot, label: label)
    case .branch(let sessionId, let repoRoot, let branch):
      BranchView(sessionId: sessionId, repoRoot: repoRoot, branch: branch)
    case .commit(let sessionId, let hash, let subject):
      CommitView(sessionId: sessionId, hash: hash, subject: subject)
    case .branchCompare(let sessionId, let left, let right):
      BranchCompareView(sessionId: sessionId, left: left, right: right)
    case .devices:
      DevicesView()
    case .device(let id, let platform, let name, let isTv):
      DeviceView(deviceId: id, platform: platform, name: name, isTv: isTv)
    case .inbox:
      InboxView()
    case .proposal(let id):
      // Keyed so swapping one proposal for another doesn't keep the old one's state.
      ProposalView(proposalId: id).id(id)
    case .pullRequests:
      PullRequestsView()
    case .issues:
      IssuesView()
    case .issue(let ref):
      IssueView(ref: ref).id(ref)
    case .design(let url, let sessionId):
      DesignView(url: url, sessionId: sessionId).id(url)
    case .pullRequest(let repo, let number, let label):
      PullRequestView(repo: repo, number: number, label: label)
    case .reviewGuide(let target, let label):
      ReviewGuideView(target: target, label: label).id(target)
    case .automations:
      AutomationsView()
    case .automation(let id, let label):
      AutomationView(automationId: id, label: label)
    case .quickRun:
      QuickRunView()
    case .automationEditor(let id, _):
      AutomationEditorView(automationId: id)
    case .describeAutomation:
      DescribeAutomationView()
    case .run(let id, let label):
      RunView(runId: id, label: label)
    case .settings:
      SettingsView()
    case .settingsPage(let page):
      page.screen
    case .notifications:
      WarningsView()
    case .computers:
      HomeView()
    case .account:
      AccountView()
    case .addComputer:
      AddComputerView()
    case .claudeAccounts:
      ClaudeAccountsView()
    case .usage:
      PhoneUsageRoot()
    case .usageModel(let tab, let runner, let model, let range):
      HostUsageModelView(metric: tab.metric ?? .cost, key: UsageModelKey(runner: runner, model: model), range: range)
        .phoneUsageNavigation(push)
        .navigationTitle(model)
        .navigationBarTitleDisplayMode(.inline)
    case .usagePrices:
      PhoneUsagePricesView()
    case .usageModels:
      PhoneUsageModelsView()
    case .more:
      MoreView()
    }
  }
}

/// Usage as a tab's root or a pushed screen; its rows push onto that stack.
struct PhoneUsageRoot: View {
  @Environment(Router.self) private var router
  @Environment(\.stackPush) private var stackPush

  var body: some View {
    HostUsageView()
      .phoneUsageNavigation(stackPush ?? router.push)
      .navigationTitle("Usage")
      .navigationBarTitleDisplayMode(.inline)
  }
}

/// The price editor on the phone: editing needs the control tier, and Save or
/// Cancel pops back to where it was opened.
private struct PhoneUsagePricesView: View {
  @Environment(HostStore.self) private var host
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    HostUsagePricesView(canEdit: host.hasControl) { dismiss() }
      .navigationTitle("Model prices")
      .navigationBarTitleDisplayMode(.inline)
  }
}

/// Which models Usage counts; editing needs the control tier.
private struct PhoneUsageModelsView: View {
  @Environment(HostStore.self) private var host

  var body: some View {
    HostUsageModelFilterView(canEdit: host.hasControl)
      .navigationTitle("Counted models")
      .navigationBarTitleDisplayMode(.inline)
  }
}

private struct PhoneUsageNavigation: ViewModifier {
  @Environment(HostStore.self) private var host
  let push: @MainActor (Route) -> Void

  func body(content: Content) -> some View {
    content.environment(
      \.usageNavigation,
      UsageNavigation(
        openModel: { key, tab, range in
          push(.usageModel(tab: tab, runner: key.runner, model: key.model, range: range))
        },
        openPrices: { added in
          host.pendingPriceModel = added
          push(.usagePrices)
        },
        openCountedModels: { push(.usageModels) }))
  }
}

extension View {
  /// Usage's model rows and price actions push onto the stack this screen is on.
  func phoneUsageNavigation(_ push: @escaping @MainActor (Route) -> Void) -> some View {
    modifier(PhoneUsageNavigation(push: push))
  }
}
