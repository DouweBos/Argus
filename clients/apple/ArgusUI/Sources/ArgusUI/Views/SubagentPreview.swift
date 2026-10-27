import ArgusCore
import SwiftUI

/// A collapsed subagent's latest tool calls, one line each, under its header —
/// what the desktop shows so a running subagent is never a closed box.
struct SubagentPreview: View {
  @Environment(\.theme) private var theme

  let calls: [RemoteToolCall]
  let earlier: Int
  let onExpand: () -> Void

  var body: some View {
    Button(action: onExpand) {
      VStack(alignment: .leading, spacing: 2) {
        ForEach(calls) { call in
          row(call)
        }
        if earlier > 0 {
          Text("+\(earlier) more")
            .textCase(.uppercase)
            .font(.scaled(size: 9, weight: .semibold))
            .tracking(0.8)
            .foregroundStyle(theme.textMuted)
            .padding(.top, 2)
        }
      }
      .padding(.leading, 10)
      .overlay(alignment: .leading) {
        Rectangle().fill(theme.borderSubtle).frame(width: 1)
      }
      .padding(.leading, 16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .contentShape(Rectangle())
    }
    .buttonStyle(.argusPlain)
    .accessibilityLabel("Subagent activity, \(calls.count + earlier) tool calls")
    .accessibilityHint("Shows every call")
  }

  private func row(_ call: RemoteToolCall) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Text(ToolCallSummary.label(name: call.name, input: call.input))
        .font(.scaled(size: 11, design: .monospaced))
        .foregroundStyle(theme.accent.opacity(0.85))
        .lineLimit(1)
        .fixedSize()
      MonoText(
        text: ToolCallSummary.summary(name: call.name, input: call.input),
        size: 11, color: theme.textMuted, lineLimit: 1,
        truncateHead: ToolCallSummary.isPathTool(call.name))
    }
    .opacity(0.85)
  }
}
