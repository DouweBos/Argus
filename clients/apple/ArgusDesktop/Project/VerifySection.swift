import ArgusCore
import ArgusKit
import ArgusUI
import SwiftUI

/// The `verify` block: what `/implement-ticket` drives and checks before it reports.
struct VerifySection: View {
  @Binding var draft: ArgusConfigDraft
  /// Simulator and emulator names offered by Add device; the gallery passes fixtures.
  var knownDevices: [String]?
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  @State private var loadedDevices: [String] = []

  var body: some View {
    SectionIntro(
      title: "Verify",
      text: "How an agent proves its work here: the devices it drives, the checks that must pass after its last change, how it signs in and how to slow the backend down for loading states. Saved to .argus.json and shared with the team."
    )
    Section("Devices") {
      if draft.verifyDevices.isEmpty {
        Text("No devices — the agent verifies on whatever it has").foregroundStyle(theme.textMuted)
      }
      ForEach($draft.verifyDevices) { $device in
        HStack {
          Image(systemName: icon(device.value)).foregroundStyle(theme.textSecondary).frame(width: 18)
          TextField("Device", text: $device.value, prompt: Text("iPhone 17 Pro")).labelsHidden()
          RemoveButton { draft.verifyDevices.removeAll { $0.id == device.id } }
        }
      }
      addDeviceMenu
    }
    StringListEditor(
      label: "Checks", items: $draft.verifyChecks, placeholder: "pnpm lint",
      emptyLabel: "No checks")
    Section {
      TextField("Sign in", text: $draft.verifySignIn, prompt: Text("/login"))
    } footer: {
      Text("A /skill or a shell command the agent runs to sign in on each device before driving the app.")
    }
    Section {
      Toggle("Screenshot a baseline before changing code", isOn: $draft.verifyBaseline)
    }
    Section {
      TextField("Slow backend", text: $draft.verifySlowBackend, prompt: Text("pnpm proxy --delay 3000"))
    } footer: {
      Text("How to slow the backend down so first loads and loading states can be checked. Leave blank to skip.")
    }
    .task { await loadDevices() }
  }

  private var addDeviceMenu: some View {
    Menu {
      ForEach(offered, id: \.self) { name in
        Button(name) { draft.verifyDevices.append(.init(name)) }
      }
      if !offered.isEmpty { Divider() }
      Button("Other…") { draft.verifyDevices.append(.init()) }
    } label: {
      Label("Add device", systemImage: "plus")
    }
    .menuStyle(.borderlessButton)
    .fixedSize()
    .clickable()
  }

  /// Known names not already listed, with the browser first.
  private var offered: [String] {
    let taken = Set(draft.verifyDevices.map(\.value))
    return (["web"] + (knownDevices ?? loadedDevices)).filter { !taken.contains($0) }
  }

  private func icon(_ name: String) -> String {
    let lower = name.lowercased()
    if lower == "web" { return "globe" }
    if lower.contains("ipad") || lower.contains("tablet") { return "ipad" }
    return "iphone"
  }

  private func loadDevices() async {
    guard knownDevices == nil, let backend = model.backend else { return }
    let devices = (try? await backend.request(ArgusProtocol.Commands.ListDevices.self, .init())) ?? []
    var seen = Set<String>()
    loadedDevices = devices.filter { $0.platform != .web && $0.deviceHostLabel == nil }.map(\.name)
      .filter { seen.insert($0).inserted }
  }
}
