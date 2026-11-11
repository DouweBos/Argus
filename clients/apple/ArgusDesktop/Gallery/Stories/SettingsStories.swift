#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// The Settings window, its Argus Account page in each state, and the custom runner editor.
  enum SettingsStories {
    static var all: [GalleryStory] {
      [
        GalleryStory("settings/window", size: CGSize(width: 960, height: 680), setup: { stage in
          stage.model.settingsTab = .appearance
          stage.model.account.galleryFill(GalleryAccount(selfKind: "mac"))
        }) {
          SettingsWindow()
        },
        GalleryStory("settings/appearance", size: page) { AppearanceSettingsTab() },
        GalleryStory("settings/agents", size: CGSize(width: 760, height: 1400)) { AgentsStage() },
        account("signed-in", GalleryAccount(selfKind: "mac")),
        account("signed-out", GalleryAccount(phase: .signedOut, selfKind: "mac")),
        account("awaiting-approval", GalleryAccount(phase: .awaitingApproval, selfKind: "mac")),
        customRunner("acp-agent", acpDraft),
        customRunner("gateway", gatewayDraft),
        verify("empty", ArgusConfigDraft()),
        verify("filled", verifyDraft),
      ]
    }

    private static var verifyDraft: ArgusConfigDraft {
      var draft = ArgusConfigDraft()
      draft.verifyDevices = ["iPhone 17 Pro", "iPad Pro 13-inch (M5)"].map { .init($0) }
      draft.verifyChecks = ["pnpm tsc --noEmit", "pnpm lint", "pnpm test", "maestro test .maestro/smoke"].map { .init($0) }
      draft.verifySignIn = "/login-test-account"
      draft.verifySlowBackend = "pnpm mock-api --latency 3000"
      return draft
    }

    private static func verify(_ state: String, _ draft: ArgusConfigDraft) -> GalleryStory {
      GalleryStory("project-settings/verify/\(state)", size: CGSize(width: 710, height: 760)) {
        VerifyStage(draft: draft)
      }
    }

    private static let acpDraft = CustomRunnerDraft(
      runnerId: "custom:goose", displayName: "Goose", baseRunnerId: CustomRunnerDraft.acpBaseId,
      env: ["GOOSE_PROVIDER": "anthropic", "ANTHROPIC_API_KEY": "sk-ant-0000"], models: [],
      defaultModel: nil,
      acp: .init(
        command: "goose", args: ["acp"], installHint: "Install it with `brew install block-goose-cli`.",
        loginHint: "Run `goose configure` in a terminal."))

    private static let gatewayDraft = CustomRunnerDraft(
      runnerId: "custom:apex", displayName: "Apex", baseRunnerId: "claude-code",
      env: ["ANTHROPIC_BASE_URL": "https://api.callstack.ai", "ANTHROPIC_AUTH_TOKEN": "sk-0000"],
      models: [.init(id: "callstack/Apex", displayName: "Apex")], defaultModel: "callstack/Apex")

    private static let baseRunners: [ArgusProtocol.RegisteredRunner] = [
      ("claude-code", "Claude Code"), ("codex", "Codex"), ("gemini", "Gemini CLI"), ("opencode", "OpenCode"),
    ].map { id, name in
      .init(
        id: id, displayName: name,
        capabilities: .init(
          supportsMcp: true, supportsTranscriptFork: false, supportsSetModel: true,
          supportsSetPermissionMode: true, supportsSetEffort: false, supportsInterrupt: true,
          supportsSideQuestion: false),
        isCustom: false, models: [])
    }

    private static func customRunner(_ state: String, _ draft: CustomRunnerDraft) -> GalleryStory {
      GalleryStory("settings/custom-runner/\(state)", size: CGSize(width: 760, height: 560)) {
        CustomRunnerEditorStage(draft: draft, baseRunners: baseRunners)
      }
    }

    private static let page = CGSize(width: 760, height: 900)

    /// The Agents tab with the gate off, so the toggle's off state shows.
    private struct AgentsStage: View {
      @State private var host: HostSettingsModel = {
        let host = HostSettingsModel()
        host.galleryFill(.init(followUpSuggestions: true, doneGate: false, warmAgents: 1))
        return host
      }()

      var body: some View { AgentsSettingsTab().environment(host) }
    }

    private static func account(_ state: String, _ fixture: GalleryAccount) -> GalleryStory {
      GalleryStory(
        "settings/account/\(state)", size: CGSize(width: 760, height: 1400),
        setup: { stage in stage.model.account.galleryFill(fixture) }
      ) {
        AccountSettingsTab()
      }
    }
  }

  private struct VerifyStage: View {
    @State var draft: ArgusConfigDraft

    var body: some View {
      Form {
        VerifySection(draft: $draft, knownDevices: ["iPhone 17 Pro", "iPhone 16e", "iPad Pro 13-inch (M5)", "Pixel 9"])
      }
      .formStyle(.grouped)
      .toggleStyle(.argusSwitch)
    }
  }

  private struct CustomRunnerEditorStage: View {
    @State var draft: CustomRunnerDraft
    let baseRunners: [ArgusProtocol.RegisteredRunner]

    var body: some View {
      Form {
        CustomRunnerEditor(
          draft: $draft, baseRunners: baseRunners, saving: false, error: nil, onSave: {}, onDelete: {})
      }
      .formStyle(.grouped)
    }
  }
#endif
