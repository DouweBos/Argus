import AppKit
import ArgusCore
import ArgusUI
import SwiftUI

/// Pairing: the QR and copy-paste code, then the device's 6-digit code to
/// compare with the grants it's offered, then done or failed.
struct PairingSheet: View {
  @Environment(\.theme) private var theme
  @Bindable var model: RemoteSettingsModel
  @State private var copied = false

  var body: some View {
    VStack(spacing: 16) {
      Text("Pair a Device").font(.title2.weight(.semibold))
      content
    }
    .padding(24)
    .frame(width: 440)
    .frame(minHeight: 320)
  }

  @ViewBuilder
  private var content: some View {
    switch model.pairing.phase {
    case .idle, .starting:
      ProgressView("Starting…").frame(maxHeight: .infinity)
      footer { Button("Cancel", role: .cancel, action: model.closePairing).keyboardShortcut(.cancelAction) }
    case .waitingForDevice(let qrPayload, let pairingCode):
      Text("Scan this with Argus on your phone, then confirm the 6-digit code matches on both screens.")
        .multilineTextAlignment(.center).foregroundStyle(theme.textSecondary)
      QRCodeView(payload: qrPayload)
      Text("Or paste this code into the app:").font(.callout).foregroundStyle(theme.textSecondary)
      codeRow(pairingCode)
      HStack(spacing: 6) {
        ProgressView().controlSize(.small)
        Text("Waiting for the device…").foregroundStyle(theme.textSecondary)
      }
      footer { Button("Cancel", role: .cancel, action: model.closePairing).keyboardShortcut(.cancelAction) }
    case .confirming(let sas, let client), .confirmingSent(let sas, let client):
      confirm(sas: sas, client: client)
    case .paired(let label):
      outcome(
        icon: "checkmark.circle.fill", tone: theme.success, title: "Paired",
        message: "\(label) can now reach this Mac.")
    case .failed(let message):
      outcome(icon: "xmark.circle.fill", tone: theme.error, title: "Pairing failed", message: message)
    }
  }

  @ViewBuilder
  private func confirm(sas: String, client: PairingClientInfo?) -> some View {
    let sent = if case .confirmingSent = model.pairing.phase { true } else { false }
    Text(
      client.map { "\($0.label) wants to pair. Confirm this code matches the one on its screen:" }
        ?? "Confirm this code matches the one on your device:"
    )
    .multilineTextAlignment(.center)
    .foregroundStyle(theme.textSecondary)
    Text(sas)
      .font(.system(size: 40, weight: .semibold, design: .monospaced))
      .tracking(8)
      .textSelection(.enabled)
      .accessibilityLabel("Pairing code \(sas)")
    VStack(alignment: .leading, spacing: 8) {
      Toggle(
        "Allow this device to control agents (send messages, spawn agents, create sessions)",
        isOn: Binding(
          get: { model.pairing.grantControl || model.pairing.grantAdmin },
          set: { model.pairing.grantControl = $0 })
      )
      .disabled(model.pairing.grantAdmin)
      if model.pairing.offersAdmin {
        Toggle(
          "Let this device drive Argus like a second keyboard — for another Mac of yours running the desktop app, never a browser or phone.",
          isOn: $model.pairing.grantAdmin)
      }
    }
    .toggleStyle(.checkbox)
    .disabled(sent)
    footer {
      Button("Cancel", role: .cancel, action: model.closePairing).keyboardShortcut(.cancelAction)
      Button(sent ? "Pairing…" : "Codes Match — Pair") {
        Task { await model.confirmPairing() }
      }
      .keyboardShortcut(.defaultAction)
      .disabled(sent)
    }
  }

  private func codeRow(_ code: String) -> some View {
    HStack {
      Text(code)
        .font(.system(.callout, design: .monospaced))
        .lineLimit(2)
        .truncationMode(.middle)
        .textSelection(.enabled)
      Button {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(code, forType: .string)
        copied = true
      } label: {
        Image(systemName: copied ? "checkmark" : "doc.on.doc")
      }
      .buttonStyle(.borderless)
      .help("Copy pairing code")
      .accessibilityLabel("Copy pairing code")
    }
    .padding(8)
    .background(theme.bgTertiary, in: .rect(cornerRadius: 6))
  }

  @ViewBuilder
  private func outcome(icon: String, tone: Color, title: String, message: String) -> some View {
    Image(systemName: icon).font(.system(size: 40)).foregroundStyle(tone)
    Text(title).font(.headline)
    Text(message).multilineTextAlignment(.center).foregroundStyle(theme.textSecondary).textSelection(.enabled)
    footer { Button("Done", action: model.closePairing).keyboardShortcut(.defaultAction) }
  }

  private func footer<Buttons: View>(@ViewBuilder _ buttons: () -> Buttons) -> some View {
    HStack {
      Spacer()
      buttons()
    }
    .padding(.top, 8)
  }
}
