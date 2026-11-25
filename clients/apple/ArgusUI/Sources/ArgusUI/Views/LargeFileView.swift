import ArgusCore
import SwiftUI

/// A file too large to open whole: read-only, a page at a time, under a banner saying why.
public struct LargeFileView: View {
  @Environment(\.theme) private var theme
  let pager: LargeFilePager
  /// What the banner says can't be done with it: "edit" on the Mac, "show in full" on a phone.
  let limitation: String

  public init(pager: LargeFilePager, limitation: String) {
    self.pager = pager
    self.limitation = limitation
  }

  public var body: some View {
    VStack(spacing: 0) {
      Banner(
        text: "At \(Self.size(pager.size)) this file is too large to \(limitation), so it opens read-only, "
          + "a page at a time.",
        tone: .accent, title: "Read-only: large file")
      content.frame(maxWidth: .infinity, maxHeight: .infinity)
      if pager.page != nil {
        Rectangle().fill(theme.border).frame(height: 1)
        footer
      }
    }
    .background(theme.bg)
    .task { if pager.page == nil, !pager.isBinary { await pager.start() } }
  }

  @ViewBuilder private var content: some View {
    if pager.isBinary {
      EmptyState(icon: "doc.questionmark", title: "Binary file", body: "This file isn't text, so there's nothing to page through.")
    } else if let page = pager.page {
      CodeView(text: page.lines.joined(separator: "\n"), language: nil, firstLine: page.firstLine)
        .id(page.offset)
    } else if let failure = pager.failure {
      EmptyState(icon: "exclamationmark.triangle", title: "Can't read this file", body: failure) {
        Btn(label: "Try Again", tone: .secondary, small: true, hugs: true) { Task { await pager.start() } }
      }
    } else {
      ProgressView().controlSize(.small)
    }
  }

  private var footer: some View {
    HStack(spacing: 10) {
      if let page = pager.page {
        Text(Self.summary(page, pager: pager))
          .font(.scaled(size: 11))
          .foregroundStyle(theme.textSecondary)
          .lineLimit(1)
          .monospacedDigit()
      }
      Spacer(minLength: 8)
      if pager.isLoading { ProgressView().controlSize(.mini) }
      Btn(label: "Previous", tone: .secondary, small: true, icon: "chevron.left", hugs: true) {
        Task { await pager.previous() }
      }
      .disabled(!pager.hasPrevious || pager.isLoading)
      .accessibilityLabel("Previous page")
      Btn(label: "Next", tone: .secondary, small: true, icon: "chevron.right", hugs: true) {
        Task { await pager.next() }
      }
      .disabled(!pager.hasNext || pager.isLoading)
      .accessibilityLabel("Next page")
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 6)
    .background(theme.bgSecondary)
  }

  static func size(_ bytes: Int) -> String {
    ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
  }

  static func summary(_ page: LargeFilePager.Page, pager: LargeFilePager) -> String {
    let last = page.firstLine + max(0, page.lines.count - 1)
    let percent = Int((pager.progress * 100).rounded(.down))
    return "Lines \(page.firstLine.formatted())–\(last.formatted()) · \(percent)% of \(size(pager.size))"
  }
}
