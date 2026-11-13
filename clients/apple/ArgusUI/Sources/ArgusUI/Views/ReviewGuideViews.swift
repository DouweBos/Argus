import ArgusCore
import SwiftUI

/// What the guide says before its stops: the change in brief, how far you've got, and a stale warning.
public struct ReviewGuideHeader: View {
  @Environment(\.theme) private var theme
  let guide: ArgusProtocol.RemoteReviewGuide
  let stale: Bool
  let visited: Int
  let canRewrite: Bool
  let onRewrite: () -> Void

  public init(
    guide: ArgusProtocol.RemoteReviewGuide, stale: Bool, visited: Int, canRewrite: Bool, onRewrite: @escaping () -> Void
  ) {
    self.guide = guide
    self.stale = stale
    self.visited = visited
    self.canRewrite = canRewrite
    self.onRewrite = onRewrite
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if stale {
        Banner(
          text: "The changes moved on since this guide was written.", tone: .warning,
          actionLabel: canRewrite ? "Rewrite" : nil, action: canRewrite ? onRewrite : nil)
      }
      if !guide.overview.isEmpty {
        MarkdownView(text: guide.overview, baseSize: 13).textSelection(.enabled)
      }
      HStack(spacing: 8) {
        ProgressView(value: Double(visited), total: Double(max(guide.stops.count, 1)))
          .tint(theme.accent)
          .frame(maxWidth: 160)
        MutedText("\(visited) of \(DiffReviewPrompt.plural(guide.stops.count, "stop")) read")
      }
    }
  }
}

/// A stop in the guide's list: its number, title and what kind of stop it is.
public struct ReviewGuideStopRow: View {
  @Environment(\.theme) private var theme
  let index: Int
  let stop: ReviewGuideStop
  let visited: Bool
  let comments: Int

  public init(index: Int, stop: ReviewGuideStop, visited: Bool, comments: Int = 0) {
    self.index = index
    self.stop = stop
    self.visited = visited
    self.comments = comments
  }

  public var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      ZStack {
        Circle().fill(visited ? theme.accent : theme.bgTertiary)
        if visited {
          Image(systemName: Icon.check).font(.scaled(size: 9, weight: .bold)).foregroundStyle(theme.bg)
        } else {
          Text("\(index + 1)").font(.scaled(size: 10, weight: .semibold)).foregroundStyle(theme.textMuted)
        }
      }
      .frame(width: 18, height: 18)
      .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
      VStack(alignment: .leading, spacing: 3) {
        Text(stop.title).font(.scaled(size: 13, weight: .medium)).foregroundStyle(theme.text).lineLimit(2)
        HStack(spacing: 6) {
          MutedText(DiffReviewPrompt.plural(stop.paths.count, "file"))
          if stop.mechanical { Badge(label: "Mechanical", tone: .muted) }
          if !stop.lookClosely.isEmpty { Badge(label: "Look closely", tone: .warning) }
          if comments > 0 { Badge(label: DiffReviewPrompt.plural(comments, "comment"), tone: .accent) }
        }
      }
      Spacer(minLength: 0)
    }
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
    .accessibilityValue(visited ? "Read" : "Not read")
  }
}

/// No guide yet, one being written, or one that failed — and the button that writes it.
public struct ReviewGuidePlaceholder: View {
  let state: ReviewGuideState?
  let error: String?
  let canWrite: Bool
  let onWrite: () -> Void

  public init(state: ReviewGuideState?, error: String?, canWrite: Bool, onWrite: @escaping () -> Void) {
    self.state = state
    self.error = error
    self.canWrite = canWrite
    self.onWrite = onWrite
  }

  public var body: some View {
    switch state?.status {
    case .generating?:
      VStack(spacing: 10) {
        Loading(label: "Claude is reading the changes…")
        MutedText("A guide takes a minute or two. You can leave and come back.")
      }
      .frame(maxWidth: .infinity)
      .padding(.vertical, 24)
    case .failed?:
      EmptyState(icon: Icon.warning, title: "Couldn't write a guide", body: state?.error ?? error, selectable: true) {
        if canWrite { Btn(label: "Try Again", tone: .secondary, small: true, icon: Icon.refresh, action: onWrite).fixedSize() }
      }
    case nil where error != nil:
      EmptyState(icon: Icon.warning, title: "Couldn't load the guide", body: error, selectable: true) {
        EmptyView()
      }
    case nil:
      Loading(label: "Loading guide…").frame(maxWidth: .infinity).padding(.vertical, 24)
    default:
      EmptyState(
        icon: Icon.guide, title: "Review guide",
        body: "Claude reads the changes and writes a tour of them: where to start, what to read closely, and what's mechanical."
      ) {
        if canWrite { Btn(label: "Write a Guide", small: true, icon: Icon.guide, action: onWrite).fixedSize() }
      }
    }
  }
}

extension View {
  /// Keeps the target's guide current: loads it, and polls while one is being written.
  public func reviewGuideLoading(_ target: ReviewGuideTarget, host: HostStore) -> some View {
    modifier(ReviewGuideLoading(target: target, host: host))
  }
}

private struct ReviewGuideLoading: ViewModifier {
  let target: ReviewGuideTarget
  let host: HostStore

  private struct Polling: Hashable {
    let target: ReviewGuideTarget
    let generating: Bool
  }

  func body(content: Content) -> some View {
    let generating = host.reviewGuides.state(target)?.status == .generating
    content
      .task(id: target) {
        await host.loadReviewGuide(target)
        if host.reviewGuides.state(target)?.guide != nil { host.trackReviewGuideOpened(target) }
      }
      .task(id: Polling(target: target, generating: generating)) {
        guard generating else { return }
        while !Task.isCancelled, host.reviewGuides.state(target)?.status == .generating {
          try? await Task.sleep(for: .seconds(3))
          await host.loadReviewGuide(target)
        }
      }
  }
}
