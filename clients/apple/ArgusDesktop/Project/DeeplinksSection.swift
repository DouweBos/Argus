import ArgusCore
import ArgusUI
import SwiftUI

struct DeeplinksSection: View {
  @Binding var draft: ArgusConfigDraft
  @Environment(\.theme) private var theme

  var body: some View {
    SectionIntro(
      title: "Simulator deep links",
      text: "Deep links surfaced by the runtime toolbar's Link dropdown when a simulator or emulator is connected. Each entry fires conductor open-link <url> against the device. Group related entries under folders — folders may contain folders."
    )
    Section {
      if draft.deeplinks.isEmpty { Text("No deep links").foregroundStyle(theme.textMuted) }
      DeeplinkLevel(root: $draft.deeplinks, entries: $draft.deeplinks, depth: 0)
    }
  }
}

/// One level of the tree: its entries, then add buttons for this level.
/// Rows drag by their handle: onto a link to land before it, onto a folder to
/// land inside it, onto a level's add row to land at its end.
private struct DeeplinkLevel: View {
  @Binding var root: [ArgusConfigDraft.Deeplink]
  @Binding var entries: [ArgusConfigDraft.Deeplink]
  var folder: UUID?
  let depth: Int
  @State private var targeted = false

  var body: some View {
    ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
      DeeplinkRow(entry: $entries[index], depth: depth) { entries.remove(at: index) } drop: { id in
        move(id, to: entry.isFolder ? .append(to: entry.id) : .before(entry.id))
      }
      if entry.isFolder {
        DeeplinkLevel(root: $root, entries: children(index), folder: entry.id, depth: depth + 1)
      }
    }
    HStack(spacing: 14) {
      AddButton("Link") { entries.append(.init()) }
      AddButton("Folder") { entries.append(.init(children: [])) }
    }
    .padding(.leading, CGFloat(depth) * 18)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(targeted ? Color.accentColor.opacity(0.15) : .clear)
    .dropDestination(for: String.self) { ids, _ in
      ids.first.map { move($0, to: .append(to: folder)) } ?? false
    } isTargeted: { targeted = $0 }
  }

  private func move(_ raw: String, to drop: DeeplinkDrop) -> Bool {
    guard let id = UUID(uuidString: raw) else { return false }
    withAnimation { root.moveDeeplink(id, to: drop) }
    return true
  }

  private func children(_ index: Int) -> Binding<[ArgusConfigDraft.Deeplink]> {
    Binding(get: { entries[index].children ?? [] }, set: { entries[index].children = $0 })
  }
}

private struct DeeplinkRow: View {
  @Binding var entry: ArgusConfigDraft.Deeplink
  let depth: Int
  let remove: () -> Void
  let drop: (String) -> Bool
  @State private var targeted = false

  var body: some View {
    HStack {
      Image(systemName: "line.3.horizontal")
        .foregroundStyle(.secondary)
        .frame(width: 16)
        .contentShape(Rectangle())
        .draggable(entry.id.uuidString) { Label(entry.label.isEmpty ? "Untitled" : entry.label, systemImage: icon) }
        .help("Drag to reorder")
        .accessibilityLabel("Reorder \(entry.label)")
      Image(systemName: icon).frame(width: 16)
      TextField("Label", text: $entry.label, prompt: Text(entry.isFolder ? "Folder" : "Profile")).labelsHidden()
      if !entry.isFolder {
        TextField("URL", text: $entry.url, prompt: Text("myapp://profile/123")).labelsHidden()
          .font(.system(.body, design: .monospaced))
      }
      RemoveButton(action: remove)
    }
    .padding(.leading, CGFloat(depth) * 18)
    .background(targeted ? Color.accentColor.opacity(0.15) : .clear)
    .dropDestination(for: String.self) { ids, _ in
      ids.first.map(drop) ?? false
    } isTargeted: { targeted = $0 }
  }

  private var icon: String { entry.isFolder ? "folder" : "link" }
}
