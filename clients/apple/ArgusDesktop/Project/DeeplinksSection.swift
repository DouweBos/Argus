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
      DeeplinkLevel(entries: $draft.deeplinks, depth: 0)
    }
  }
}

/// One level of the tree: its entries, then add buttons for this level.
private struct DeeplinkLevel: View {
  @Binding var entries: [ArgusConfigDraft.Deeplink]
  let depth: Int

  var body: some View {
    ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
      DeeplinkRow(entry: $entries[index], depth: depth) { entries.remove(at: index) } move: {
        entries.move(at: index, by: $0)
      }
      if entry.isFolder {
        DeeplinkLevel(entries: children(index), depth: depth + 1)
      }
    }
    HStack(spacing: 14) {
      AddButton("Link") { entries.append(.init()) }
      AddButton("Folder") { entries.append(.init(children: [])) }
    }
    .padding(.leading, CGFloat(depth) * 18)
  }

  private func children(_ index: Int) -> Binding<[ArgusConfigDraft.Deeplink]> {
    Binding(get: { entries[index].children ?? [] }, set: { entries[index].children = $0 })
  }
}

private struct DeeplinkRow: View {
  @Binding var entry: ArgusConfigDraft.Deeplink
  let depth: Int
  let remove: () -> Void
  let move: (Int) -> Void

  var body: some View {
    HStack {
      Image(systemName: entry.isFolder ? "folder" : "link").frame(width: 16)
      TextField("Label", text: $entry.label, prompt: Text(entry.isFolder ? "Folder" : "Profile")).labelsHidden()
      if !entry.isFolder {
        TextField("URL", text: $entry.url, prompt: Text("myapp://profile/123")).labelsHidden()
          .font(.system(.body, design: .monospaced))
      }
      Button { move(-1) } label: { Image(systemName: "chevron.up") }
        .buttonStyle(.borderless).accessibilityLabel("Move up")
      Button { move(1) } label: { Image(systemName: "chevron.down") }
        .buttonStyle(.borderless).accessibilityLabel("Move down")
      RemoveButton(action: remove)
    }
    .padding(.leading, CGFloat(depth) * 18)
  }
}
