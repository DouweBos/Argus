import ArgusCore
import SwiftUI

public typealias PullRequestReviewEvent = ArgusProtocol.MethodsTypes.GithubReviewPullRequestParamsEvent

/// Posts a pull request's draft comments as one review on its code host: comment, approve or request changes.
public struct PullRequestReviewSheet: View {
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  let comments: Int
  let submit: (PullRequestReviewEvent, String) async -> Bool
  @State private var event: PullRequestReviewEvent = .cOMMENT
  @State private var text = ""
  @State private var posting = false

  public init(comments: Int, submit: @escaping (PullRequestReviewEvent, String) async -> Bool) {
    self.comments = comments
    self.submit = submit
  }

  private static let events: [(PullRequestReviewEvent, String)] = [
    (.cOMMENT, "Comment"), (.aPPROVE, "Approve"), (.rEQUESTCHANGES, "Request Changes"),
  ]

  /// GitHub wants a body for everything but an approval.
  private var canPost: Bool {
    !posting && (event == .aPPROVE || comments > 0 || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
  }

  public var body: some View {
    NavigationStack {
      Form {
        Picker("Review", selection: $event) {
          ForEach(Self.events, id: \.0.rawValue) { Text($0.1).tag($0.0) }
        }
        .pickerStyle(.segmented)
        TextField("Summary (optional)", text: $text, axis: .vertical).lineLimit(3...8)
        if comments > 0 {
          Text("With \(DiffReviewPrompt.plural(comments, "inline comment")). It's posted as you.")
            .font(.scaled(size: 12)).foregroundStyle(theme.textMuted)
        } else {
          Text("It's posted as you.").font(.scaled(size: 12)).foregroundStyle(theme.textMuted)
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Finish Review")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Post") {
            posting = true
            Task {
              let posted = await submit(event, text.trimmingCharacters(in: .whitespacesAndNewlines))
              posting = false
              if posted { dismiss() }
            }
          }
          .disabled(!canPost)
        }
      }
    }
    .presentationDetents([.medium, .large])
    #if os(macOS)
      .frame(width: 440, height: 300)
    #endif
  }
}

/// A pull request's drafts under the screen: how many, discard, and finish as one review.
public struct PullRequestReviewBar: View {
  @Environment(HostStore.self) private var host
  let repo: String
  let number: Int
  @State private var finishing = false
  @State private var confirmingDiscard = false

  public init(repo: String, number: Int) {
    self.repo = repo
    self.number = number
  }

  private var key: String { ReviewGuideTarget.pullRequest(repo: repo, number: number, headSha: nil).key }

  public var body: some View {
    let comments = host.reviews.comments(key)
    HStack(spacing: 10) {
      VStack(alignment: .leading, spacing: 2) {
        Text(comments.isEmpty ? "No comments yet" : DiffReviewPrompt.plural(comments.count, "comment"))
          .font(.scaled(size: 14, weight: .semibold))
        MutedText(comments.isEmpty ? "Tap a line to comment" : "on \(DiffReviewPrompt.plural(Set(comments.map(\.path)).count, "file"))")
      }
      Spacer(minLength: 6)
      if !comments.isEmpty {
        Btn(label: "Discard", tone: .ghost, small: true) { confirmingDiscard = true }.fixedSize()
      }
      Btn(label: "Finish Review", small: true, icon: Icon.send) { finishing = true }.fixedSize()
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
    .background(.bar)
    .sheet(isPresented: $finishing) {
      PullRequestReviewSheet(comments: comments.count) { event, body in
        await host.submitPullRequestReview(repo: repo, number: number, event: event, body: body)
      }
    }
    .confirmationDialog(
      "Discard \(DiffReviewPrompt.plural(comments.count, "comment"))?", isPresented: $confirmingDiscard,
      titleVisibility: .visible
    ) {
      Button("Discard", role: .destructive) { host.discardReview(sessionId: key) }
    }
  }
}
