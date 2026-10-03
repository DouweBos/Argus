import ArgusCore
import Foundation
import SwiftUI

/// A notification the agent sent to your devices, shown as what it is rather
/// than as a tool call: its title and message, never the raw result.
struct PushNotificationCard: View {
  @Environment(\.theme) private var theme

  let call: RemoteToolCall

  private var title: String? {
    call.input["title"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
  }

  /// The tool answers `{"delivered": bool}`; anything else isn't a failure.
  private var undelivered: Bool {
    let text = call.resultBlocks.compactMap { block -> String? in
      if case .text(let text) = block { return text }
      return nil
    }.joined()
    guard let data = text.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return false }
    return object["delivered"] as? Bool == false
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 6) {
        Image(systemName: Icon.notification)
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(theme.accent)
        Text("Notification")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(theme.accent)
        Spacer(minLength: 4)
        if undelivered { Badge(label: "not delivered", tone: .danger) }
        if call.isError == true { Badge(label: "error", tone: .danger) }
      }
      if let title {
        Text(title)
          .font(.system(size: 15, weight: .semibold))
          .foregroundStyle(theme.text)
      }
      if let body = call.input["body"]?.stringValue, !body.isEmpty {
        MarkdownView(text: body, baseSize: 14)
      }
    }
    .padding(11)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(theme.accentSoft)
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
    .overlay(
      RoundedRectangle(cornerRadius: theme.radiusSmall).stroke(theme.accentBorder, lineWidth: 1))
    .accessibilityElement(children: .combine)
  }
}
