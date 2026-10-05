import ArgusUI
import GroveKit
import SwiftUI

/// Icon, title and explanation at the top of a history sheet.
struct SheetHeader: View {
  @Environment(\.theme) private var theme
  let symbol: String
  let title: String
  let message: String
  var isDestructive = false

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: symbol)
        .font(.scaled(size: 20))
        .foregroundStyle(isDestructive ? theme.error : theme.accent)
        .frame(width: 28)
      VStack(alignment: .leading, spacing: 4) {
        Text(title).font(.scaled(.headline))
        Text(message).font(.scaled(size: 12)).foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }
}

/// A coloured note inside a sheet: a warning or the error git gave.
struct SheetBanner: View {
  @Environment(\.theme) private var theme
  let message: String
  let tone: Tone

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: symbol)
        .foregroundStyle(tone.color(theme))
      Text(message).font(.scaled(size: 12)).textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(10)
    .background(tone.soft(theme), in: .rect(cornerRadius: 6))
  }

  private var symbol: String {
    switch tone {
    case .danger: "xmark.octagon.fill"
    case .success: "checkmark.circle.fill"
    default: "exclamationmark.triangle.fill"
    }
  }
}

/// Cancel and the primary action, which shows progress while it runs.
struct SheetFooter: View {
  let primaryTitle: String
  var isDestructive = false
  var isBusy = false
  var isDisabled = false
  let cancel: () -> Void
  let perform: () async -> Void

  var body: some View {
    HStack {
      if isBusy { ProgressView().controlSize(.small) }
      Spacer()
      Button("Cancel", action: cancel).keyboardShortcut(.cancelAction)
      Button(primaryTitle, role: isDestructive ? .destructive : nil) { Task { await perform() } }
        .keyboardShortcut(.defaultAction)
        .disabled(isDisabled || isBusy)
    }
  }
}

/// One commit, compact: SHA, subject, author.
struct CommitSummaryTile: View {
  @Environment(\.theme) private var theme
  let commit: CommitInfo

  var body: some View {
    HStack(spacing: 8) {
      Text(commit.shortSHA).font(.scaled(size: 11, design: .monospaced)).foregroundStyle(.secondary)
      Text(commit.summary).lineLimit(1)
      Spacer(minLength: 4)
      Text(commit.authorName).font(.scaled(size: 11)).foregroundStyle(.secondary).lineLimit(1)
    }
    .font(.scaled(size: 12))
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
    .background(theme.bgTertiary, in: .rect(cornerRadius: 6))
  }
}

enum CommitDates {
  static let full: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateStyle = .long
    formatter.timeStyle = .short
    return formatter
  }()
}
