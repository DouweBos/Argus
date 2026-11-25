import AppKit
import ArgusCore
import ArgusUI
import SwiftUI

/// Adding a workspace: create the app with a configuration token (or from the
/// manifest by hand), then paste the two tokens Slack has no API for.
struct SlackSetupGroup: View {
  let pendingApp: ArgusProtocol.SlackApp?
  /// Set while other workspaces are connected: stop adding one.
  var cancel: (() -> Void)? = nil
  @State private var name = SlackSetupGroup.defaultName
  @State private var byHand = false

  var body: some View {
    if let app = pendingApp {
      SlackTokensGroup(app: app, name: $name, byHand: $byHand, cancel: cancel)
    } else if byHand {
      SlackTokensGroup(app: nil, name: $name, byHand: $byHand, cancel: cancel)
    } else {
      SlackCreateAppGroup(name: $name, byHand: $byHand, cancel: cancel)
    }
  }

  /// Named after the person, so teammates' bots in one workspace tell apart.
  static var defaultName: String {
    guard let first = NSFullUserName().split(separator: " ").first, !first.isEmpty else { return "Argus" }
    return String("Argus (\(first))".prefix(35))
  }
}

enum SlackAppLinks {
  static let apps = URL(string: "https://api.slack.com/apps")!
  static func page(_ app: ArgusProtocol.SlackApp, _ path: String) -> URL? {
    URL(string: "https://api.slack.com/apps/\(app.id)/\(path)")
  }
}

private struct SlackCreateAppGroup: View {
  @Environment(HostSettingsModel.self) private var host
  @Environment(HostStore.self) private var store
  @Environment(\.openURL) private var openURL
  @Binding var name: String
  @Binding var byHand: Bool
  let cancel: (() -> Void)?
  @State private var configToken = ""
  @State private var busy = false

  private var canCreate: Bool {
    !busy && !name.trimmingCharacters(in: .whitespaces).isEmpty
      && !configToken.trimmingCharacters(in: .whitespaces).isEmpty
  }

  var body: some View {
    SettingsGroup(
      cancel == nil ? "Slack" : "Add a Slack workspace",
      footer:
        "Argus creates the Slack app in the token's workspace, then forgets the token. Slack expires it after 12 hours."
    ) {
      SettingsRow(
        "Bot name",
        description: "How the bot shows in Slack. Name it after yourself when teammates connect their own Argus."
      ) {
        TextField("Bot name", text: $name, prompt: Text("Argus"))
          .frame(width: 260)
      }
      SettingsRow(
        "Configuration token",
        description:
          "On Slack's apps page, under Your App Configuration Tokens, generate one for the workspace and copy the access token, starting xoxe.xoxp-."
      ) {
        SecureField("Configuration token", text: $configToken, prompt: Text("xoxe.xoxp-"))
          .frame(width: 260)
          .onSubmit { if canCreate { Task { await create() } } }
      }
      HStack(spacing: 8) {
        Button("Open Slack apps") { openURL(SlackAppLinks.apps) }
        Spacer()
        if let cancel { Button("Cancel", action: cancel) }
        Button("Create by hand") { byHand = true }
          .help("Create the app from a manifest yourself instead")
        Button(busy ? "Creating" : "Create app") { Task { await create() } }
          .buttonStyle(.borderedProminent)
          .disabled(!canCreate)
      }
    }
  }

  private func create() async {
    busy = true
    defer { busy = false }
    let overview = await host.run(
      ArgusProtocol.Commands.SlackCreateApp.self,
      .init(
        configToken: configToken.trimmingCharacters(in: .whitespaces),
        name: name.trimmingCharacters(in: .whitespaces)))
    guard overview != nil else { return }
    configToken = ""
    applySlack(overview, to: store)
  }
}

/// The app exists (or is made by hand): its app-level token and bot token.
private struct SlackTokensGroup: View {
  @Environment(HostSettingsModel.self) private var host
  @Environment(HostStore.self) private var store
  @Environment(\.openURL) private var openURL
  let app: ArgusProtocol.SlackApp?
  @Binding var name: String
  @Binding var byHand: Bool
  let cancel: (() -> Void)?
  @State private var busy = false
  @State private var copied = false

  var body: some View {
    SettingsGroup(
      cancel == nil ? "Slack" : "Add a Slack workspace",
      footer:
        "Argus reaches Slack over an outbound connection, so nothing but Slack sits between your workspace and this Mac. The tokens are checked with Slack, then encrypted here; they never leave this Mac."
    ) {
      if let app {
        SettingsRow(
          app.name,
          description: "Created in your workspace. Generate its app-level token and install it, then paste both tokens below."
        ) {
          Button("Start over") { Task { await startOver() } }
            .disabled(busy)
            .help("Forget this app and create another; delete it in Slack if you no longer need it")
        }
      } else {
        SettingsRow("Bot name", description: "How the bot shows in Slack; the manifest carries it.") {
          TextField("Bot name", text: $name, prompt: Text("Argus"))
            .frame(width: 260)
        }
        SettingsRow(
          "Slack app",
          description: "Create the app in your workspace from this manifest, install it, then paste its tokens below."
        ) {
          HStack(spacing: 8) {
            Button("Open Slack apps") { openURL(SlackAppLinks.apps) }
            Button(copied ? "Copied" : "Copy manifest") { Task { await copyManifest() } }
          }
        }
      }
      SlackTokenRows(app: app) {
        if app == nil {
          Button("Use a configuration token") { byHand = false }
            .help("Let Argus create the app for you")
        }
        if let cancel { Button("Cancel", action: cancel) }
      }
    }
  }

  private func copyManifest() async {
    let trimmed = name.trimmingCharacters(in: .whitespaces)
    guard
      let manifest = await host.run(
        ArgusProtocol.Commands.SlackManifest.self, .init(name: trimmed.isEmpty ? nil : trimmed))
    else { return }
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(manifest, forType: .string)
    copied = true
    try? await Task.sleep(for: .seconds(2))
    copied = false
  }

  private func startOver() async {
    busy = true
    defer { busy = false }
    applySlack(await host.run(ArgusProtocol.Commands.SlackForgetApp.self, EmptyParams()), to: store)
  }
}

/// The two token fields and Connect, with links to the app's pages when Argus created it.
/// Connecting a workspace Argus knows reconnects it.
struct SlackTokenRows<Leading: View>: View {
  @Environment(HostSettingsModel.self) private var host
  @Environment(HostStore.self) private var store
  @Environment(\.openURL) private var openURL
  let app: ArgusProtocol.SlackApp?
  @ViewBuilder var leading: () -> Leading
  @State private var botToken = ""
  @State private var appToken = ""
  @State private var busy = false

  private var canConnect: Bool {
    !busy && !botToken.trimmingCharacters(in: .whitespaces).isEmpty
      && !appToken.trimmingCharacters(in: .whitespaces).isEmpty
  }

  var body: some View {
    SettingsRow(
      "App-level token",
      description: "Basic Information → App-Level Tokens → Generate Token and Scopes, with the connections:write scope, starting xapp-."
    ) {
      HStack(spacing: 8) {
        if let app, let url = SlackAppLinks.page(app, "general") {
          Button("Generate") { openURL(url) }
        }
        SecureField("App-level token", text: $appToken, prompt: Text("xapp-"))
          .frame(width: 260)
      }
    }
    SettingsRow(
      "Bot token",
      description: "Install App → Install to Workspace, then copy the Bot User OAuth Token, starting xoxb-."
    ) {
      HStack(spacing: 8) {
        if let app, let url = SlackAppLinks.page(app, "install-on-team") {
          Button("Install") { openURL(url) }
        }
        SecureField("Bot token", text: $botToken, prompt: Text("xoxb-"))
          .frame(width: 260)
          .onSubmit { if canConnect { Task { await connect() } } }
      }
    }
    HStack(spacing: 8) {
      leading()
      Spacer()
      Button(busy ? "Connecting" : "Connect") { Task { await connect() } }
        .buttonStyle(.borderedProminent)
        .disabled(!canConnect)
    }
  }

  private func connect() async {
    busy = true
    defer { busy = false }
    let overview = await host.run(
      ArgusProtocol.Commands.SlackConnect.self,
      .init(
        botToken: botToken.trimmingCharacters(in: .whitespaces),
        appToken: appToken.trimmingCharacters(in: .whitespaces)))
    guard overview != nil else { return }
    botToken = ""
    appToken = ""
    applySlack(overview, to: store)
  }
}

extension SlackTokenRows where Leading == EmptyView {
  init(app: ArgusProtocol.SlackApp?) {
    self.init(app: app) { EmptyView() }
  }
}
