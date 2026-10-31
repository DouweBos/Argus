import SwiftUI

/// What sits under a transcript in place of the composer: why you can't
/// write to this agent, and whatever you can do instead.
public struct TranscriptFooterNote<Content: View>: View {
  @Environment(\.theme) private var theme
  let content: Content

  public init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 6) { content }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(theme.space)
      .background(theme.bgSecondary)
      .overlay(alignment: .top) { Rectangle().fill(theme.border).frame(height: 0.5) }
  }
}

extension TranscriptFooterNote where Content == MutedText {
  public init(_ text: String) {
    self.init { MutedText(text) }
  }
}
