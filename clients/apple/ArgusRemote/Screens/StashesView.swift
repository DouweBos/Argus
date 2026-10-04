import ArgusUI
import SwiftUI

/// A session's stashes and tags. Applying, popping or dropping a stash needs
/// control; tags are read-only here — creating and pushing them stays with
/// the desktop's git views.
struct StashesView: View {
  @Environment(HostStore.self) private var host

  let sessionId: String
  let label: String

  @State private var stashes: [ArgusProtocol.GitStashEntry] = []
  @State private var tags: [ArgusProtocol.GitTag] = []
  @State private var loaded = false
  @State private var busy: Int?
  @State private var note: String?
  @State private var dropping: ArgusProtocol.GitStashEntry?

  var body: some View {
    Screen {
      if let note {
        MutedText(note, lineLimit: 4)
      }
      if !loaded {
        Loading(label: "Reading stashes…")
      } else {
        SectionHeader(title: "Stashes", count: stashes.count)
        if stashes.isEmpty {
          MutedText("Nothing stashed.")
        }
        ForEach(stashes, id: \.hash) { stash in
          stashCard(stash)
        }
        SectionHeader(title: "Tags", count: tags.count)
        if tags.isEmpty {
          MutedText("No tags.")
        }
        ForEach(tags, id: \.name) { tag in
          Card {
            HStack(spacing: 6) {
              BodyText(tag.name, lineLimit: 1)
              if tag.pushed == false { Badge(label: "not pushed") }
            }
            MutedText("\(String(tag.commitHash.prefix(7))) \(tag.subject)", lineLimit: 2)
          }
        }
      }
    }
    .navigationTitle("Stashes & tags · \(label)")
    .navigationBarTitleDisplayMode(.inline)
    .task { await refresh() }
    .refreshable { await refresh() }
    .alert(
      "Drop this stash?",
      isPresented: Binding(get: { dropping != nil }, set: { if !$0 { dropping = nil } })
    ) {
      Button("Cancel", role: .cancel) { dropping = nil }
      Button("Drop", role: .destructive) {
        guard let stash = dropping else { return }
        dropping = nil
        Task {
          busy = Int(stash.index)
          if await host.dropStash(sessionId: sessionId, index: Int(stash.index)) {
            note = "Dropped stash@{\(Int(stash.index))}."
          }
          busy = nil
          await refresh()
        }
      }
    } message: {
      Text("The stashed changes are gone for good.")
    }
  }

  private func stashCard(_ stash: ArgusProtocol.GitStashEntry) -> some View {
    let index = Int(stash.index)
    return Card {
      HStack(spacing: 6) {
        Badge(label: "stash@{\(index)}")
        MutedText(Self.when(stash.date), lineLimit: 1)
      }
      BodyText(stash.message, lineLimit: 3)
      if host.hasControl {
        FlowRow(spacing: 8) {
          Btn(label: "Apply", tone: .secondary, small: true) { apply(index, drop: false) }
          Btn(label: "Pop", tone: .secondary, small: true) { apply(index, drop: true) }
          Btn(label: "Drop", tone: .ghost, small: true) { dropping = stash }
        }
        .disabled(busy != nil)
      }
    }
    .opacity(busy == index ? 0.5 : 1)
  }

  /// Git's ISO date as "3h ago"; the raw string if it doesn't parse.
  static func when(_ iso: String) -> String {
    guard let date = ISO8601DateFormatter().date(from: iso) else { return iso }
    return Labels.timeAgo(date.timeIntervalSince1970 * 1000)
  }

  private func apply(_ index: Int, drop: Bool) {
    busy = index
    Task {
      if let output = await host.applyStash(sessionId: sessionId, index: index, drop: drop) {
        note = output.isEmpty ? (drop ? "Popped." : "Applied.") : output
      }
      busy = nil
      await refresh()
    }
  }

  private func refresh() async {
    stashes = await host.listStashes(sessionId: sessionId)
    tags = await host.listTags(sessionId: sessionId)
    loaded = true
  }
}
