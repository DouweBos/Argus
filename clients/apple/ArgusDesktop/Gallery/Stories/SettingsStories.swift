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
        account("signed-in", GalleryAccount(selfKind: "mac")),
        account("signed-out", GalleryAccount(phase: .signedOut, selfKind: "mac")),
        account("awaiting-approval", GalleryAccount(phase: .awaitingApproval, selfKind: "mac")),
        customRunner("acp-agent", acpDraft),
        customRunner("gateway", gatewayDraft),
      ]
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

    private static func account(_ state: String, _ fixture: GalleryAccount) -> GalleryStory {
      GalleryStory(
        "settings/account/\(state)", size: CGSize(width: 760, height: 1400),
        setup: { stage in stage.model.account.galleryFill(fixture) }
      ) {
        AccountSettingsTab()
      }
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
