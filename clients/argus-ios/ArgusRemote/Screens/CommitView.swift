import ArgusKit
import SwiftUI

/// One commit's diff, file by file.
struct CommitView: View {
  @Environment(AppStore.self) private var app

  let sessionId: String
  let hash: String
  let subject: String

  @State private var diff: String?

  private var files: [DiffFile] { diff.map(DiffParser.parse) ?? [] }

  var body: some View {
    Screen {
      Card {
        BodyText(subject)
        MonoText(text: hash, size: 11, lineLimit: 1)
      }
      if diff == nil {
        Loading(label: "Reading the commit…")
      } else if files.isEmpty {
        MutedText("No file changes.")
      } else {
        SectionHeader(title: "Files", count: files.count)
        ForEach(files) { file in
          FileDiffCard(file: file)
        }
      }
    }
    .navigationTitle(String(hash.prefix(8)))
    .navigationBarTitleDisplayMode(.inline)
    .task { diff = await app.commitDiff(sessionId: sessionId, hash: hash) ?? "" }
  }
}

/// A commit in a list: subject, short hash, author and age.
struct CommitRow: View {
  @Environment(\.theme) private var theme

  let subject: String
  let hash: String
  let author: String
  /// Epoch ms, when known.
  let millis: Double?
  let onTap: () -> Void

  var body: some View {
    Card(onTap: onTap) {
      BodyText(subject, lineLimit: 2)
      HStack(spacing: 6) {
        MonoText(text: String(hash.prefix(8)), size: 11, color: theme.textMuted)
        MutedText(author, lineLimit: 1)
        Spacer(minLength: 6)
        if let millis { MutedText(Labels.timeAgo(millis)) }
      }
    }
  }
}
