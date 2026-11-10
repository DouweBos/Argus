import ArgusUI
import SwiftUI

/// A session's stashes and tags, as the Mac's stash list: long-press a stash
/// for its menu, swipe to apply or drop. Tags are read-only here.
struct StashesView: View {
  @Environment(\.theme) private var theme
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
    List {
      if let note {
        Section { MutedText(note, lineLimit: 4) }
      }
      Section("Stashes · \(stashes.count)") {
        if stashes.isEmpty { MutedText("Nothing stashed.") }
        ForEach(stashes, id: \.hash) { stash in
          StashRow(stash: stash)
            .opacity(busy == Int(stash.index) ? 0.5 : 1)
            .contextMenu { if host.hasControl { menu(stash) } }
            .swipeActions(edge: .leading) {
              if host.hasControl {
                Button("Apply", systemImage: Icon.download) { apply(Int(stash.index), drop: false) }
                  .tint(theme.accent)
              }
            }
            .swipeActions(edge: .trailing) {
              // Asks first; a full swipe never drops on its own.
              if host.hasControl {
                Button("Drop", systemImage: Icon.trash) { dropping = stash }.tint(theme.error)
              }
            }
        }
      }
      Section("Tags · \(tags.count)") {
        if tags.isEmpty { MutedText("No tags.") }
        ForEach(tags, id: \.name) { tag in
          VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
              BodyText(tag.name, lineLimit: 1)
              if tag.pushed == false { Badge(label: "not pushed") }
            }
            MutedText("\(String(tag.commitHash.prefix(7))) \(tag.subject)", lineLimit: 1)
          }
        }
      }
    }
    .disabled(busy != nil)
    .loadPhase(LoadPhase(loaded: loaded, error: nil, isEmpty: false), loading: "Reading stashes…") {
      EmptyView()
    }
    .navigationTitle("Stashes & Tags · \(label)")
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

  @ViewBuilder
  private func menu(_ stash: ArgusProtocol.GitStashEntry) -> some View {
    let index = Int(stash.index)
    Button("Apply", systemImage: Icon.download) { apply(index, drop: false) }
    Button("Pop", systemImage: Icon.download) { apply(index, drop: true) }
    Button("Copy Message", systemImage: Icon.copy) { UIPasteboard.general.string = stash.message }
    Divider()
    Button("Drop…", systemImage: Icon.trash, role: .destructive) { dropping = stash }
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
    let listed = await host.listStashes(sessionId: sessionId)
    let tagged = await host.listTags(sessionId: sessionId)
    // Left mid-load: an unanswered list isn't an empty one.
    guard !Task.isCancelled else { return }
    stashes = listed
    tags = tagged
    loaded = true
  }
}

/// A stash as the Mac lists it: the message, then its ref, branch and age.
private struct StashRow: View {
  @Environment(\.theme) private var theme
  let stash: ArgusProtocol.GitStashEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      BodyText(stash.message, lineLimit: 2)
      HStack(spacing: 6) {
        Text("stash@{\(Int(stash.index))}").font(.caption.monospaced())
        if let branch = Self.branch(of: stash.message) {
          Label(branch, systemImage: Icon.branch).labelStyle(.titleAndIcon)
        }
        Spacer(minLength: 4)
        Text(StashesView.when(stash.date))
      }
      .font(.caption)
      .foregroundStyle(theme.textSecondary)
      .lineLimit(1)
    }
  }

  /// Git names the branch in the message: "On main: …" or "WIP on main: …".
  static func branch(of message: String) -> String? {
    guard let match = message.firstMatch(of: /^(?:WIP on|On) ([^:]+):/) else { return nil }
    return String(match.1)
  }
}
