import ArgusKit
import SwiftUI

/// The card for an agent's `request_secret`: a masked field whose value goes to
/// the host alone, never into the chat.
public struct SecretRequestForm: View {
  @Environment(\.theme) private var theme
  let request: SecretRequest
  let onSubmit: (String) -> Void
  let onDecline: () -> Void

  @State private var value = ""

  public init(
    request: SecretRequest, onSubmit: @escaping (String) -> Void, onDecline: @escaping () -> Void
  ) {
    self.request = request
    self.onSubmit = onSubmit
    self.onDecline = onDecline
  }

  private var canSubmit: Bool { !value.isEmpty }

  public var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 6) {
        Image(systemName: Icon.lock)
          .font(.scaled(size: 12, weight: .semibold))
          .foregroundStyle(theme.textMuted)
        Text(request.label)
          .font(.scaled(size: 13, weight: .semibold))
          .foregroundStyle(theme.text)
      }
      if !request.reason.isEmpty {
        Text(request.reason)
          .font(.scaled(size: 13))
          .foregroundStyle(theme.textSecondary)
      }
      ThemedTextField(
        placeholder: request.label, text: $value, mono: true, input: .code, secure: true,
        onSubmit: submit)
      MutedText("\(request.destination) It never appears in the chat.")
      HStack(spacing: 8) {
        Btn(label: "Send securely", small: true, fills: true, action: submit)
          .disabled(!canSubmit)
        Btn(label: "Decline", tone: .secondary, small: true, fills: true, action: onDecline)
      }
    }
  }

  private func submit() {
    guard canSubmit else { return }
    let sent = value
    value = ""
    onSubmit(sent)
  }
}
