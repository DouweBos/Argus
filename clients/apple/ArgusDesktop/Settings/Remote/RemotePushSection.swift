import ArgusCore
import ArgusUI
import SwiftUI

/// Background push. Nothing secret is ever read back: browsers get a key Argus
/// generates itself and phones go through the relay, so the only field is the
/// contact the push services may use.
struct RemotePushSection: View {
  @Environment(\.theme) private var theme
  let model: RemoteSettingsModel
  let gatewayOn: Bool
  @State private var contact = ""

  private var enabled: Bool { model.push?.enabled ?? false }

  var body: some View {
    SettingsGroup(
      "Background push",
      footer: "Wake paired phones and browsers with a real notification when they're not connected — agent finished, agent failed, or a prompt needs approval. Nothing to set up: every notification is encrypted for the device it's going to before it leaves this machine. The contact is what Mozilla, Google, and Apple use to reach you if a browser notification misbehaves."
    ) {
      SettingsRow("Background push") {
        HStack(spacing: 10) {
          if model.push != nil {
            ToneLabel(tone: enabled ? .success : .idle, text: enabled ? "ready" : "off")
          }
          Toggle("Background push", isOn: binding)
            .toggleStyle(.switch)
            .controlSize(.small)
            .disabled(!gatewayOn || model.busy || model.push == nil)
        }
      }
      if enabled, let push = model.push {
        SettingsRow("Push service contact") {
          HStack {
            TextField("Push service contact", text: $contact, prompt: Text("mailto:you@example.com"))
              .textFieldStyle(.roundedBorder)
              .frame(width: 220)
            Button("Save Contact") {
              Task { await model.setPush(.init(vapidSubject: contact), setting: .pushContact) }
            }
            .disabled(!gatewayOn || model.busy || contact.trimmingCharacters(in: .whitespaces).isEmpty)
          }
        }
        SettingsRow(
          "Browser push key",
          description: "Phones are reached through \(push.relayUrl), which only ever handles ciphertext."
        ) {
          Text(push.webPushConfigured ? "generated" : "made on first use").foregroundStyle(theme.textSecondary)
        }
      }
    }
    .onChange(of: model.push?.vapidSubject, initial: true) { _, subject in
      if let subject { contact = subject }
    }
  }

  private var binding: Binding<Bool> {
    Binding(
      get: { enabled },
      set: { next in Task { await model.setPush(.init(enabled: next), setting: .push, on: next) } })
  }
}
