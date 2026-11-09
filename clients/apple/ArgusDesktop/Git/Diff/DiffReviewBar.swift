import ArgusCore
import ArgusUI
import SwiftUI

/// The session's draft review under the git views: how many comments, discard, and send to the agent.
struct DiffReviewBar: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let sessionId: String
  @State private var sending = false
  @State private var confirmingDiscard = false

  private var comments: [DiffReviewComment] { model.store.reviews.comments(sessionId) }

  var body: some View {
    let comments = comments
    if !comments.isEmpty {
      VStack(spacing: 0) {
        Rectangle().fill(theme.border).frame(height: 1)
        HStack(spacing: 8) {
          Image(systemName: "text.bubble").foregroundStyle(theme.accent)
          Text(summary(comments)).font(.scaled(size: 12, weight: .medium))
          Menu {
            ForEach(comments) { comment in
              Text("\(comment.location) — \(comment.body)")
            }
          } label: {
            Text("Show").font(.scaled(size: 12))
          }
          .menuStyle(.borderlessButton)
          .fixedSize()
          .clickable()
          Spacer()
          Button("Discard") { confirmingDiscard = true }
            .buttonStyle(.secondary)
          Button("Send Review to Agent") {
            sending = true
            Task {
              await model.sendReview(session: sessionId)
              sending = false
            }
          }
          .buttonStyle(AccentButtonStyle())
          .disabled(sending)
          .help("Send every comment to the session's agent as one message")
        }
        .padding(.horizontal, 12)
        .frame(height: 40)
      }
      .confirmationDialog(
        "Discard \(DiffReviewPrompt.plural(comments.count, "comment"))?", isPresented: $confirmingDiscard
      ) {
        Button("Discard", role: .destructive) { model.store.discardReview(sessionId: sessionId) }
      }
    }
  }

  private func summary(_ comments: [DiffReviewComment]) -> String {
    let files = Set(comments.map(\.path)).count
    return "\(DiffReviewPrompt.plural(comments.count, "comment")) on \(DiffReviewPrompt.plural(files, "file"))"
  }
}
