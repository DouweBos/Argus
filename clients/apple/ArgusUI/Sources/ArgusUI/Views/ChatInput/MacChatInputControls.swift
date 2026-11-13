#if os(macOS)
  import ArgusCore
  import SwiftUI

  /// The pills along the composer's foot: a start's runner, model (and account),
  /// effort, permission mode and linked projects — each a dropdown over the agent's state.
  extension MacChatInputView {
    var controlRow: some View {
      // Wraps instead of growing: a fixed-size row widened the middle column
      // and squeezed the sidebar.
      ChipFlowLayout(spacing: 2) {
        // First: the models and effort levels on offer depend on it.
        if composer.isComparing {
          compareSlotPills
        } else {
          if composer.starter != nil, host.runners.count > 1 {
            runnerMenu
            ComposerPillDivider()
          }
          modelMenu
          if !composer.effortLevels.isEmpty {
            ComposerPillDivider()
            effortMenu
          }
        }
        ComposerPillDivider()
        permissionMenu
        ComposerPillDivider()
        projectMenu
        if composer.hasConversation && host.supportsSideQuestion(agentId: composer.agentId) {
          ComposerPillDivider()
          sideQuestionButton
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .disabled(!composer.isEnabled)
    }

    private var modelMenu: some View {
      ChromeMenuButton(isPresented: $composer.showingModelPicker, edge: .above) {
        ComposerModelMenu.entries(composer)
      } label: { open in
        ComposerPillLabel(icon: Icon.agent, title: composer.modelLabel, open: open)
      }
      .buttonStyle(.argusPlain)
      .fixedSize()
      .help(modelHelp)
    }

    private var modelHelp: String {
      guard composer.offersAccounts, let account = composer.effectiveAccountName else { return "Switch model" }
      return "Switch model or account · on \(account)"
    }

    /// Which CLI the started agent runs on; one whose CLI is missing opens its setup, or is
    /// listed disabled with how to install it where setup can't run.
    private var runnerMenu: some View {
      ChromeMenuButton(edge: .above) {
        ChromeMenuEntry.header("Runner")
        ChromeMenuItem("Default", subtitle: "Use the computer's default", checked: composer.runner == nil) {
          pickRunner(nil)
        }
        for runner in host.runners {
          let installable = runnerSetup != nil && RunnerSetupAction.offers(runner)
          ChromeMenuItem(
            runner.displayName, subtitle: installable ? "Not installed · Install…" : runner.pickerHint,
            checked: runner.id == composer.runner?.id, disabled: !runner.isAvailable && !installable
          ) {
            if runner.isAvailable { pickRunner(runner) } else { runnerSetup?(runner) }
          }
        }
        if composer.offersCompare {
          ChromeMenuEntry.divider
          ChromeMenuItem("Compare runners…", subtitle: "Start the prompt on several at once", icon: .symbol(Icon.compare)) {
            composer.beginCompare()
          }
        }
      } label: { open in
        ComposerPillLabel(
          icon: Icon.terminal, title: composer.runner?.displayName ?? "Default runner",
          accent: composer.runner != nil, open: open)
      }
      .buttonStyle(.argusPlain)
      .fixedSize()
      .help("The CLI the agent runs on")
    }

    private func pickRunner(_ runner: RemoteRunner?) {
      guard runner?.id != composer.runner?.id else { return }
      composer.setRunner(runner)
      composer.onAffordance?(.runnerPicked)
    }

    private var permissionMenu: some View {
      ChromeMenuButton(edge: .above) {
        for mode in RemotePermissionMode.allCases {
          ChromeMenuItem(ComposerPermissionMode.label(mode), checked: mode == composer.permissionMode) {
            composer.setPermissionMode(mode)
          }
        }
      } label: { open in
        ComposerPillLabel(
          icon: Icon.lock, title: ComposerPermissionMode.label(composer.permissionMode), accent: composer.permissionMode != .auto,
          open: open)
      }
      .buttonStyle(.argusPlain)
      .fixedSize()
      .help("\(ComposerPermissionMode.description(composer.permissionMode)) (⇧Tab to cycle)")
    }

    private var effortMenu: some View {
      ChromeMenuButton(edge: .above) {
        for level in [String?.none] + composer.effortLevels.map(Optional.some) {
          ChromeMenuItem(ComposerEffort.label(level), checked: level == composer.effort) {
            composer.setEffort(level)
          }
        }
      } label: { open in
        ComposerPillLabel(icon: Icon.clock, title: ComposerEffort.label(composer.effort), open: open)
      }
      .buttonStyle(.argusPlain)
      .fixedSize()
      .help("Reasoning effort")
    }

    private var sideQuestionButton: some View {
      let asked = host.sideQuestionsByAgent[composer.agentId]?.count ?? 0
      return Button {
        showingSideQuestion.toggle()
      } label: {
        ComposerPillLabel(
          icon: Icon.sideQuestion, title: asked == 0 ? nil : "\(asked)", accent: asked > 0, chevron: false,
          open: showingSideQuestion)
      }
      .buttonStyle(.argusPlain)
      .fixedSize()
      .help("Ask a side question without interrupting the agent")
      .accessibilityLabel("Side question")
      .popover(isPresented: $showingSideQuestion, arrowEdge: .top) {
        SideQuestionPanel(agentId: composer.agentId) { composer.onAffordance?(.sideAnswerSent) }
          .padding(14)
          .frame(width: 420)
          .frame(maxHeight: 520)
      }
    }

    private var projectMenu: some View {
      ChromeMenuButton(edge: .above) {
        if composer.linkableProjects.isEmpty {
          ChromeMenuEntry.note("No other projects")
        }
        for project in composer.linkableProjects {
          ChromeMenuItem(
            project.name, icon: .badge(project.name, key: project.repoRoot), checked: composer.linkedProjects.contains(project.repoRoot),
            keepsOpen: true
          ) {
            composer.toggleLink(project.repoRoot)
          }
        }
      } label: { open in
        ComposerPillLabel(
          icon: Icon.link, title: composer.linkedProjects.isEmpty ? nil : "\(composer.linkedProjects.count) linked",
          accent: !composer.linkedProjects.isEmpty, chevron: !composer.linkedProjects.isEmpty, open: open)
      }
      .buttonStyle(.argusPlain)
      .fixedSize()
      .help(composer.linkedProjects.isEmpty ? "Link another project to this message" : "Projects linked to this message")
      .accessibilityLabel("Link other project")
    }
  }
#endif
