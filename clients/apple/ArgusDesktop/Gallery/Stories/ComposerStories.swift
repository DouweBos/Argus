#if DEBUG
  import ArgusCore
  import ArgusKit
  import ArgusUI
  import SwiftUI

  enum ComposerStories {
    static var all: [GalleryStory] {
      [
        GalleryStory("composer/dictation", size: CGSize(width: 520, height: 0)) { DictationStory(size: 26) },
        GalleryStory("composer/picked-elements", size: CGSize(width: 720, height: 0)) {
          AttachmentStrip(
            images: [], elements: [browser, browserNoReact, device, deviceNoCrop], remove: { _ in }
          )
          .padding(12)
        },
        GalleryStory(
          "composer/start/runner", size: CGSize(width: 760, height: 0),
          fixtures: [RemoteMethod.automationsRunners.rawValue: runners],
          setup: { await $0.host.loadRunners() }
        ) {
          ChatInputView(startingIn: "s-1", starter: ComposerStarter(defaultMode: "auto") { _ in true })
            .padding(.vertical, 12)
        },
        // Two other accounts and every installed runner: the rows scroll instead of growing off screen.
        GalleryStory(
          "composer/limit-handoff", size: CGSize(width: 760, height: 0),
          fixtures: [RemoteMethod.automationsRunners.rawValue: runners],
          setup: { await $0.host.loadRunners() }
        ) {
          LimitHandoffCard(agentId: "a-1", accounts: handoffAccounts) {}
            .padding(12)
        },
        // An agent running on Work while the computer's default is Personal; then a start composer.
        GalleryStory(
          "composer/account-menu/running", size: CGSize(width: 360, height: 0),
          fixtures: GalleryFixtures.transcript(.idle, runningOn: "work"), setup: { await loadAccountMenu($0.host) }
        ) { AccountMenuStory(starts: false) },
        GalleryStory(
          "composer/account-menu/start", size: CGSize(width: 360, height: 0),
          fixtures: GalleryFixtures.transcript(.idle), setup: { await loadAccountMenu($0.host) }
        ) { AccountMenuStory(starts: true) },
        GalleryStory(
          "composer/usage-limits", size: CGSize(width: 760, height: 0),
          fixtures: GalleryFixtures.composer.merging(GalleryFixtures.usage) { $1 },
          setup: { await $0.host.loadUsageLimits() }
        ) { UsageLimitsComposerStory() },
      ]
    }

    private static func loadAccountMenu(_ host: HostStore) async {
      let agent = GalleryFixtures.transcriptAgent
      await host.loadAgentStatus(agentId: agent)
      await host.loadCapabilities(agentId: agent)
      await host.loadTranscript(agentId: agent)
      await host.refreshClaudeAccounts()
    }

    private static let handoffAccounts: [ArgusProtocol.LimitHandoffAccount] = try! ProtocolCodec.decoder.decode(
      [ArgusProtocol.LimitHandoffAccount].self,
      from: Data(
        """
        [{"account_id":"work","label":"Work","detail":"team",
          "usage":{"id":"weekly","kind":"weekly","label":"Weekly","used_percent":68,"resets_at":\(
            (Date().timeIntervalSince1970 + 2 * 86400 + 18 * 3600) * 1000)}},
         {"account_id":"side","label":"Side projects","detail":"max",
          "usage":{"id":"five_hour","kind":"five_hour","label":"5-hour","used_percent":12}}]
        """.utf8))

    /// Every built-in runner plus a gateway of the user's, half of their CLIs missing.
    private static let runners = """
      {"runners":[
      {"id":"claude-code","display_name":"Claude Code","is_custom":false,"models":[],"available":true},
      {"id":"codex","display_name":"Codex","is_custom":false,"models":[],"available":false,
       "unavailable_reason":"Codex CLI (`codex`) not found on PATH. Install it with `npm install -g @openai/codex` and run `codex login`."},
      {"id":"gemini","display_name":"Gemini CLI","is_custom":false,"models":[],"available":true},
      {"id":"antigravity","display_name":"Antigravity","is_custom":false,"models":[],"available":false,
       "unavailable_reason":"Antigravity isn't installed. Install the Antigravity CLI (`agy`, 1.5 or newer) from antigravity.google."},
      {"id":"kiro","display_name":"Kiro","is_custom":false,"models":[],"available":false,
       "unavailable_reason":"Kiro isn't installed. Install Kiro CLI with `curl -fsSL https://cli.kiro.dev/install | bash`."},
      {"id":"opencode","display_name":"OpenCode","is_custom":false,"models":[],"available":true},
      {"id":"cursor","display_name":"Cursor","is_custom":false,"models":[],"available":true},
      {"id":"grok","display_name":"Grok Build","is_custom":false,"models":[],"available":false,
       "unavailable_reason":"Grok Build isn't installed. Install it with `npm install -g @xai-official/grok`."},
      {"id":"fx","display_name":"fx","is_custom":false,"models":[],"available":false,
       "unavailable_reason":"fx isn't installed. Install it with `curl -fsSL https://fx.sh/setup.sh | bash`."},
      {"id":"custom:gateway","display_name":"Team gateway","is_custom":true,"models":[],"available":true}
      ]}
      """

    /// The model pill's menu, drawn open.
    private struct AccountMenuStory: View {
      let starts: Bool
      @Environment(HostStore.self) private var host

      var body: some View {
        let composer = ComposerModel(
          agentId: GalleryFixtures.transcriptAgent, sessionId: GalleryFixtures.transcriptSession, host: host,
          starter: starts ? ComposerStarter(defaultMode: "auto") { _ in true } : nil, style: .desktop)
        ChromeMenuSurface { ComposerModelMenu.entries(composer) }
          .padding(12)
      }
    }

    private static var browser: PickedElement {
      PickedElement(
        source: .browser, title: "SaveButton · button.btn.primary", context: "", crop: crop(width: 240, height: 70))
    }

    private static var browserNoReact: PickedElement {
      PickedElement(source: .browser, title: "nav#main-navigation.sidebar", context: "", crop: crop(width: 120, height: 400))
    }

    private static var device: PickedElement {
      PickedElement(source: .device, title: "UIButton \"checkout\"", context: "", crop: crop(width: 300, height: 100))
    }

    private static var deviceNoCrop: PickedElement {
      PickedElement(source: .device, title: "RCTViewComponentView", context: "", crop: nil)
    }

    /// A flat placeholder picture standing in for a screenshot crop.
    private static func crop(width: Int, height: Int) -> RemoteImageAttachment? {
      let image = NSImage(size: NSSize(width: width, height: height), flipped: false) { rect in
        NSColor.systemBlue.setFill()
        NSBezierPath(roundedRect: rect.insetBy(dx: 8, dy: 8), xRadius: 6, yRadius: 6).fill()
        return true
      }
      guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
        let png = rep.representation(using: .png, properties: [:])
      else { return nil }
      return RemoteImageAttachment(data: png.base64EncodedString(), mediaType: "image/png")
    }
  }

  /// The mic in each phase, and the banner a refused microphone leaves above the composer.
  private struct DictationStory: View {
    @Environment(\.theme) private var theme
    let size: CGFloat
    private let phases: [(String, DictationPhase)] = [
      ("Idle", .idle), ("Getting ready", .starting), ("Listening", .listening), ("Finishing", .finishing),
    ]

    var body: some View {
      VStack(alignment: .leading, spacing: 12) {
        Banner(text: DictationError.microphoneDenied.errorDescription ?? "", actionLabel: "Dismiss") {}
        ForEach(phases, id: \.0) { name, phase in
          HStack(spacing: 10) {
            DictationButton(phase: phase, size: size) {}
            Text(name).font(.scaled(size: 13)).foregroundStyle(theme.textSecondary)
          }
        }
        HStack(spacing: 10) {
          DictationButton(phase: .idle, size: size) {}.disabled(true)
          Text("Agent not running").font(.scaled(size: 13)).foregroundStyle(theme.textSecondary)
        }
      }
      .padding(16)
    }
  }

  /// `/usage-limits`' panel over the chat composer, as it opens for a Claude Code agent.
  private struct UsageLimitsComposerStory: View {
    @Environment(HostStore.self) private var host

    var body: some View {
      VStack(spacing: 6) {
        ComposerUsageLimitsPanel(groups: UsageLimitFormat.groups(host.usageLimits, runner: "claude-code")) {}
          .readingColumn()
        ChatInputView(agentId: "a1")
      }
      .padding(.top, 12)
    }
  }
#endif
