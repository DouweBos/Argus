import ArgusKit
import WidgetKit

struct SnapshotEntry: TimelineEntry {
  let date: Date
  let snapshot: WidgetSnapshot
}

/// Every widget reads the same snapshot. The app and the notification
/// extension reload timelines when they write it, so nothing here polls; the
/// only scheduled entries are plan resets, when a usage bar drops to empty.
struct SnapshotProvider: TimelineProvider {
  func placeholder(in context: Context) -> SnapshotEntry {
    SnapshotEntry(date: Date(), snapshot: .sample)
  }

  func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
    let stored = WidgetSnapshotStore.load()
    completion(SnapshotEntry(date: Date(), snapshot: context.isPreview && stored.isEmpty ? .sample : stored))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
    let now = Date()
    let snapshot = WidgetSnapshotStore.load()
    let resets = snapshot.usage.flatMap { [$0.session?.resetsAt, $0.weekly?.resetsAt] }
      .compactMap { $0 }.filter { $0 > now }
    let dates = [now] + Set(resets).sorted().prefix(4)
    completion(Timeline(entries: dates.map { SnapshotEntry(date: $0, snapshot: snapshot) }, policy: .never))
  }
}

extension WidgetSnapshot.UsageWindow {
  /// What the bar reads at `date`: a window past its reset has started over.
  func used(at date: Date) -> Double {
    if let resetsAt, resetsAt <= date { return 0 }
    return min(max(usedPercent, 0), 100)
  }
}

extension WidgetSnapshot {
  /// The widget gallery's preview, before the app has written anything.
  static let sample: WidgetSnapshot = {
    let link = URL(string: "argus://agents")!
    let now = Date()
    return WidgetSnapshot(hosts: [
      Host(
        id: "sample", name: "Studio", updatedAt: now,
        agents: [
          Agent(id: "1", title: "Fix flaky login test", project: "web", attention: "needs approval", activityAt: now, url: link),
          Agent(id: "2", title: "Review the checkout plan", project: "shop", attention: "review plan", activityAt: now, url: link),
          Agent(id: "3", title: "Migrate settings screen", project: "ios", attention: nil, activityAt: now, url: link),
        ],
        proposals: [
          Proposal(id: "p1", title: "Bump the React Native version", url: link),
          Proposal(id: "p2", title: "Close stale Linear issues", url: link),
        ],
        proposalCount: 3,
        usage: [
          UsageAccount(
            label: "Claude",
            session: UsageWindow(usedPercent: 47, resetsAt: now.addingTimeInterval(2 * 3600)),
            weekly: UsageWindow(usedPercent: 22, resetsAt: now.addingTimeInterval(4 * 86400)))
        ])
    ])
  }()
}
