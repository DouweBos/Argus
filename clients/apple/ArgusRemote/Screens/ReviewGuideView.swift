import ArgusUI
import SwiftUI

/// A session's or pull request's review guide: the stops, then one at a time with Next.
struct ReviewGuideView: View {
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(\.stackPush) private var stackPush
  let target: ReviewGuideTarget
  let label: String
  @State private var selected: String?

  private var state: ReviewGuideState? { host.reviewGuides.state(target) }

  var body: some View {
    Screen {
      if let error = host.reviewGuides.errors[target.key], state?.guide != nil {
        Banner(text: error, tone: .danger)
      }
      if let guide = state?.guide {
        if let index = guide.stops.firstIndex(where: { $0.id == selected }) {
          stop(guide, index: index)
        } else {
          overview(guide)
        }
      } else {
        ReviewGuidePlaceholder(state: state, error: host.reviewGuides.errors[target.key], canWrite: host.hasControl) {
          write(force: false)
        }
      }
    }
    .navigationTitle(label)
    .navigationBarTitleDisplayMode(.inline)
    .screenBar {
      if selected != nil {
        Button { selected = nil } label: { Label("All stops", systemImage: Icon.menu) }
      } else if host.hasControl, state?.guide != nil, state?.status != .generating {
        Button { write(force: true) } label: { Label("Rewrite guide", systemImage: Icon.refresh) }
      }
    }
    .reviewGuideLoading(target, host: host)
    .modifier(GuideReviewBar(target: target, push: stackPush ?? router.push))
  }

  private func overview(_ guide: ArgusProtocol.RemoteReviewGuide) -> some View {
    let visited = host.reviewGuides.visited(target)
    return Group {
      Card {
        ReviewGuideHeader(guide: guide, stale: state?.stale == true, visited: visited.count, canRewrite: host.hasControl) {
          write(force: true)
        }
      }
      if state?.status == .generating { MutedText("Rewriting the guide…") }
      Card {
        ForEach(Array(guide.stops.enumerated()), id: \.element.id) { index, stop in
          Button { selected = stop.id } label: {
            ReviewGuideStopRow(
              index: index, stop: stop, visited: visited.contains(stop.id),
              comments: stop.paths.reduce(0) { $0 + host.reviews.comments(target.key, path: $1).count })
          }
          .buttonStyle(.argusPlain)
          if index < guide.stops.count - 1 { Divider() }
        }
      }
    }
  }

  private func stop(_ guide: ArgusProtocol.RemoteReviewGuide, index: Int) -> some View {
    let stops = guide.stops
    return ReviewGuideStopView(
      target: target, stop: stops[index], index: index, total: stops.count,
      onPrevious: index > 0 ? { selected = stops[index - 1].id } : nil,
      onNext: index < stops.count - 1 ? { selected = stops[index + 1].id } : { selected = nil },
      openLine: target.sessionId.map { session in
        { path, line in (stackPush ?? router.push)(.file(sessionId: session, path: path, line: line, source: .changes)) }
      }
    )
    .id(stops[index].id)
  }

  private func write(force: Bool) {
    Task { await host.generateReviewGuide(target, force: force) }
  }
}

/// A session's drafts go to its agent; a pull request's are posted as one GitHub review.
private struct GuideReviewBar: ViewModifier {
  @Environment(HostStore.self) private var host
  let target: ReviewGuideTarget
  let push: @MainActor (Route) -> Void

  func body(content: Content) -> some View {
    switch target {
    case .session(let id):
      content.diffReviewBar(sessionId: id) { agentId in
        push(.agent(id: agentId, label: host.statusByAgent[agentId].map(Labels.agentName) ?? "Agent"))
      }
    case .pullRequest(let repo, let number, _):
      content.safeAreaInset(edge: .bottom, spacing: 0) {
        if host.hasControl, host.reviewGuides.state(target)?.guide != nil {
          PullRequestReviewBar(repo: repo, number: number)
        }
      }
    }
  }
}

/// The way into a review guide from a session's changes or a pull request.
struct ReviewGuideLink: View {
  @Environment(\.theme) private var theme
  let target: ReviewGuideTarget
  let label: String

  var body: some View {
    StackLink(route: .reviewGuide(target: target, label: label)) {
      HStack(spacing: 10) {
        Image(systemName: Icon.guide).foregroundStyle(theme.accent)
        VStack(alignment: .leading, spacing: 2) {
          Text("Review guide").font(.scaled(size: 14, weight: .semibold)).foregroundStyle(theme.text)
          MutedText("A tour of the changes, stop by stop", lineLimit: 1)
        }
        Spacer(minLength: 0)
      }
      .padding(.vertical, 4)
    }
    .buttonStyle(.argusPlain)
  }
}
