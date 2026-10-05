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
    Section {
      Toggle(isOn: binding) {
        HStack {
          Text("Background push")
          Spacer()
          if model.push != nil {
            ToneLabel(tone: enabled ? .success : .idle, text: enabled ? "ready" : "off")
          }
        }
      }
      .disabled(!gatewayOn || model.busy || model.push == nil)
      if enabled, let push = model.push {
        LabeledContent("Push service contact") {
          HStack {
            TextField("Push service contact", text: $contact, prompt: Text("mailto:you@example.com"))
              .labelsHidden()
            Button("Save Contact") {
              Task { await model.setPush(.init(vapidSubject: contact), setting: .pushContact) }
            }
            .disabled(!gatewayOn || model.busy || contact.trimmingCharacters(in: .whitespaces).isEmpty)
          }
        }
        LabeledContent("Browser push key", value: push.webPushConfigured ? "generated" : "made on first use")
        Text("Phones are reached through \(push.relayUrl), which only ever handles ciphertext.")
          .font(.scaled(.callout)).foregroundStyle(theme.textSecondary)
      }
    } footer: {
      Text(
        "Wake paired phones and browsers with a real notification when they're not connected — agent finished, agent failed, or a prompt needs approval. Nothing to set up: every notification is encrypted for the device it's going to before it leaves this machine. The contact is what Mozilla, Google, and Apple use to reach you if a browser notification misbehaves."
      )
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
