import ArgusCore
import ArgusUI
import SwiftUI

/// `/compare/:groupId`: one prompt's runs side by side, to keep the best and drop the rest.
struct CompareRunView: View {
  @Environment(DesktopModel.self) private var desktop
  @Environment(HostStore.self) private var store
  @Environment(\.openURL) private var openURL
  @Environment(\.theme) private var theme
  let groupId: String
  @State private var model: CompareRunModel?
  @State private var keeping: CompareSlotScore?

  var body: some View {
    Group {
      if let model {
        content(model)
      } else {
        ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .navigationTitle(model?.title ?? "Compare")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button {
          Task { await model?.refresh() }
        } label: {
          Label("Refresh", systemImage: Icon.refresh)
        }
        .disabled(model?.refreshing ?? true)
        .help("Score the runs and take new screenshots")
      }
    }
    .task {
      let model = CompareRunModel(groupId: groupId, store: store)
      self.model = model
      await model.refresh()
    }
    .liveRefresh(enabled: model?.isWorking ?? false, every: .seconds(5)) { await model?.load() }
    .sheet(item: $keeping) { score in
      if let model {
        CompareKeepSheet(score: score, model: model) { kept in
          keeping = nil
          desktop.openAgents(session: score.sessionId)
          if let url = kept.pullRequestUrl.flatMap(URL.init(string:)) { openURL(url) }
        }
      }
    }
  }

  @ViewBuilder private func content(_ model: CompareRunModel) -> some View {
    if let slots = model.slots {
      ScrollView(.horizontal) {
        HStack(alignment: .top, spacing: theme.space) {
          ForEach(slots) { score in
            CompareSlotCard(
              score: score, runner: model.runnerName(score), model: model.modelName(score) ?? "Default model",
              reviewComments: model.reviewComments(score), screenshot: model.screenshots[score.sessionId],
              loadingScreenshot: model.loadingScreenshots.contains(score.sessionId),
              keeping: model.keepingId == score.sessionId,
              onOpen: { desktop.navigate(.session(id: score.sessionId, agentId: score.agentId)) },
              onKeep: { keeping = score }
            )
            // Share the width, but no narrower than a card reads; below that it scrolls.
            .containerRelativeFrame(.horizontal) { length, _ in
              let gaps = theme.space * CGFloat(slots.count + 1)
              return max(260, (length - gaps) / CGFloat(max(slots.count, 1)))
            }
          }
        }
        .padding(theme.space)
        .frame(maxHeight: .infinity, alignment: .top)
      }
    } else if model.loaded {
      EmptyState(
        icon: Icon.compare, title: "This compare run is gone",
        body: "Its sessions were kept or deleted, or the computer can't score them right now."
      ) {
        Button("Try Again") { Task { await model.refresh() } }
      }
    } else {
      ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}

/// Keeping a slot: how it lands and whether the others go, then one confirm.
private struct CompareKeepSheet: View {
  @Environment(\.dismiss) private var dismiss
  let score: CompareSlotScore
  let model: CompareRunModel
  let kept: (HostStore.CompareKept) -> Void
  @State private var landing: CompareLanding = .merge
  @State private var deleteOthers = true

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      CompareKeepForm(
        landing: $landing, deleteOthers: $deleteOthers, runner: model.runnerName(score),
        others: max((model.slots?.count ?? 1) - 1, 0))
      SheetFooter(primaryTitle: confirmTitle, isBusy: model.keepingId != nil, cancel: { dismiss() }) {
        guard let result = await model.keep(score, land: landing, deleteOthers: deleteOthers) else { return }
        kept(result)
      }
    }
    .padding(20)
    .frame(width: 400)
  }

  private var confirmTitle: String {
    switch landing {
    case .merge: "Merge"
    case .pullRequest: "Open Pull Request"
    case .none: "Keep Branch"
    }
  }
}
