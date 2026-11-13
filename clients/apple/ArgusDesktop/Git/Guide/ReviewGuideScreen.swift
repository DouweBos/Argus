import ArgusCore
import ArgusUI
import SwiftUI

/// A session's or pull request's review guide: the stops beside the one you're on.
struct ReviewGuideScreen: View {
  @Environment(DesktopModel.self) private var desktop
  @Environment(\.theme) private var theme
  let target: ReviewGuideTarget
  @State private var selected: String?

  private var store: HostStore { desktop.store }
  private var state: ReviewGuideState? { store.reviewGuides.state(target) }

  var body: some View {
    Group {
      if let guide = state?.guide {
        ResizableHSplit(key: "git.guide", leadingMin: 220, leadingIdeal: 300, leadingMax: 440, trailingMin: 360) {
          stopList(guide)
        } trailing: {
          stop(guide)
        }
      } else {
        ReviewGuidePlaceholder(
          state: state, error: store.reviewGuides.errors[target.key], canWrite: store.hasControl
        ) { write(force: false) }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .safeAreaInset(edge: .bottom, spacing: 0) {
      if case .pullRequest(let repo, let number, _) = target, store.hasControl, state?.guide != nil {
        PullRequestReviewBar(repo: repo, number: number)
      }
    }
    .reviewGuideLoading(target, host: store)
    .onChange(of: state?.guide?.headSha, initial: true) { _, _ in
      if let stops = state?.guide?.stops, !stops.contains(where: { $0.id == selected }) { selected = stops.first?.id }
    }
  }

  private func stopList(_ guide: ArgusProtocol.RemoteReviewGuide) -> some View {
    let visited = store.reviewGuides.visited(target)
    return List {
      ReviewGuideHeader(
        guide: guide, stale: state?.stale == true, visited: visited.count, canRewrite: store.hasControl
      ) { write(force: true) }
      .padding(.vertical, 6)
      .listRowSeparator(.hidden)
      ForEach(Array(guide.stops.enumerated()), id: \.element.id) { index, stop in
        ReviewGuideStopRow(
          index: index, stop: stop, visited: visited.contains(stop.id),
          comments: stop.paths.reduce(0) { $0 + store.reviews.comments(target.key, path: $1).count })
        .padding(.vertical, 3)
        .onTapGesture { selected = stop.id }
        .clickable()
        .modifier(NavigatorRowHighlight(selected: selected == stop.id))
      }
      if state?.status == .generating {
        Label("Rewriting…", systemImage: "hourglass").font(.scaled(size: 11)).foregroundStyle(.secondary)
      }
    }
    .navigatorList()
    .contextMenu {
      if store.hasControl { Button("Rewrite Guide") { write(force: true) } }
    }
  }

  @ViewBuilder
  private func stop(_ guide: ArgusProtocol.RemoteReviewGuide) -> some View {
    if let index = guide.stops.firstIndex(where: { $0.id == selected }) {
      let stops = guide.stops
      ScrollViewReader { proxy in
        ScrollView {
          ReviewGuideStopView(
            target: target, stop: stops[index], index: index, total: stops.count,
            onPrevious: index > 0 ? { selected = stops[index - 1].id } : nil,
            onNext: index < stops.count - 1 ? { selected = stops[index + 1].id } : nil,
            openLine: target.sessionId.map { session in
              { path, line in desktop.openCode(session: session, path: path, line: line, source: .diff) }
            }
          )
          .id(stops[index].id)
          .padding(20)
          .frame(maxWidth: 920, alignment: .leading)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onChange(of: selected) { _, id in proxy.scrollTo(id, anchor: .top) }
      }
    } else {
      QuietEmptyState(icon: Icon.guide, title: "Pick a stop")
    }
  }

  private func write(force: Bool) {
    Task { await store.generateReviewGuide(target, force: force) }
  }
}
