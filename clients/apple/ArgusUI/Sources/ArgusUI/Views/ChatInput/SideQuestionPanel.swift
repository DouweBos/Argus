import ArgusCore
import SwiftUI

/// Ask the agent something on the side: answered from a read-only copy of its
/// context, kept out of its chat unless sent there. The Mac shows it in a
/// popover off the composer, the phone in a sheet.
public struct SideQuestionPanel: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  let agentId: String
  /// Counts a side answer sent into the chat, which the host sees as a plain message.
  var onSent: (() -> Void)?

  @State private var draft = ""

  public init(agentId: String, onSent: (() -> Void)? = nil) {
    self.agentId = agentId
    self.onSent = onSent
  }

  private var exchanges: [SideQuestion] { host.sideQuestionsByAgent[agentId] ?? [] }

  public var body: some View {
    VStack(alignment: .leading, spacing: theme.space) {
      header
      if exchanges.isEmpty {
        MutedText("Answered from a read-only copy of the agent's context. Nothing is added to its chat.")
      } else {
        ScrollViewReader { proxy in
          ScrollView {
            LazyVStack(alignment: .leading, spacing: theme.space) {
              ForEach(exchanges) { exchange in
                SideQuestionRow(exchange: exchange) {
                  onSent?()
                  Task { await host.sendSideToAgent(agentId: agentId, id: exchange.id) }
                }
                .id(exchange.id)
              }
            }
          }
          .onChange(of: exchanges.last?.id) { _, id in
            guard let id else { return }
            withAnimation { proxy.scrollTo(id, anchor: .bottom) }
          }
        }
      }
      HStack(alignment: .bottom, spacing: 8) {
        ThemedTextField(placeholder: "Ask without interrupting", text: $draft, onSubmit: ask)
        Btn(label: "Ask", small: true, hugs: true, action: ask)
          .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    }
  }

  private var header: some View {
    HStack {
      Text("Side question").font(.scaled(size: 15, weight: .semibold)).foregroundStyle(theme.text)
      Spacer()
      if !exchanges.isEmpty {
        Btn(label: "Clear", tone: .ghost, small: true, hugs: true) { host.clearSideQuestions(agentId: agentId) }
          .disabled(exchanges.contains(where: \.isPending))
      }
    }
  }

  private func ask() {
    let question = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !question.isEmpty else { return }
    draft = ""
    Task { await host.askSide(agentId: agentId, question: question) }
  }
}

private struct SideQuestionRow: View {
  @Environment(\.theme) private var theme
  let exchange: SideQuestion
  let send: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(exchange.question)
        .font(.scaled(size: 14, weight: .medium))
        .foregroundStyle(theme.text)
        .textSelection(.enabled)
      if let answer = exchange.answer {
        MarkdownView(text: answer, baseSize: 14)
        HStack {
          Spacer()
          Btn(
            label: exchange.sent ? "Sent" : "Send to agent", tone: .secondary, small: true,
            icon: exchange.sent ? Icon.check : Icon.reply, hugs: true, action: send
          )
          .disabled(exchange.sent)
          .help("Add this question and answer to the agent's chat, after its current turn")
        }
      } else if let error = exchange.error {
        Text(error).font(.scaled(size: 13)).foregroundStyle(theme.error)
      } else {
        HStack(spacing: 6) {
          ProgressView().controlSize(.small)
          MutedText("Thinking…")
        }
      }
    }
    .padding(10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(theme.bgTertiary, in: .rect(cornerRadius: theme.radiusSmall))
  }
}
