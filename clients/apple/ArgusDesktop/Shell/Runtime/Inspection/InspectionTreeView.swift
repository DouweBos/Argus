import AppKit
import ArgusUI
import SwiftUI

/// The hierarchy with a search bar: ancestors of the selection and of every
/// hit stay expanded, non-hits dim — the renderer's `HierarchyTree` +
/// `HierarchySearch`.
struct InspectionTreeView: View {
  @Environment(\.theme) private var theme
  @Bindable var model: InspectionModel
  let root: Inspection.Node

  private var query: String { model.searchQuery.trimmingCharacters(in: .whitespaces) }

  var body: some View {
    let parents = root.parentMap()
    let matches = root.searchMatches(query)
    var open = model.expanded
    if let selected = model.selectedId {
      open.formUnion(Inspection.ancestors(of: selected, in: parents))
    }
    if !matches.isEmpty {
      open.formUnion(Inspection.withAncestors(matches.map(\.id), in: parents))
    }
    let rows = root.visibleRows(expanded: open)

    return VStack(spacing: 0) {
      searchBar(matches: matches)
      Divider()
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(rows, id: \.node.id) { row in
              TreeRow(
                model: model, node: row.node, level: row.level, open: open.contains(row.node.id),
                query: query)
            }
          }
          .padding(.vertical, 4)
        }
        .onChange(of: model.selectedId) { _, id in
          guard let id else { return }
          withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo(id, anchor: .center) }
        }
      }
      .focusable()
      .focusEffectDisabled()
      .onKeyPress(keys: [.upArrow, .downArrow, .leftArrow, .rightArrow]) { press in
        navigate(press.key, rows: rows.map(\.node)) ? .handled : .ignored
      }
    }
    .background(theme.bg)
  }

  private func searchBar(matches: [Inspection.Node]) -> some View {
    HStack(spacing: 6) {
      Image(systemName: Icon.search).foregroundStyle(theme.textMuted)
      TextField("Search hierarchy…", text: $model.searchQuery)
        .textFieldStyle(.plain)
        .onChange(of: model.searchQuery) { model.searchChanged() }
        .onSubmit { model.stepSearch(forward: !NSEvent.modifierFlags.contains(.shift)) }
        .onExitCommand { model.searchQuery = "" }
        .accessibilityLabel("Search hierarchy")
      if !query.isEmpty {
        let index = matches.firstIndex { $0.id == model.selectedId }.map { $0 + 1 } ?? 0
        Text(matches.isEmpty ? "no hits" : "\(index) / \(matches.count)")
          .font(.scaled(.caption).monospacedDigit())
          .foregroundStyle(matches.isEmpty ? theme.textMuted : theme.text)
        stepButton("Previous match", Icon.chevronUp, forward: false, enabled: !matches.isEmpty)
        stepButton("Next match", Icon.chevronDown, forward: true, enabled: !matches.isEmpty)
        Button {
          model.searchQuery = ""
        } label: {
          Image(systemName: "xmark.circle.fill")
        }
        .buttonStyle(.borderless)
        .foregroundStyle(theme.textMuted)
        .help("Clear search")
        .accessibilityLabel("Clear search")
      }
    }
    .controlSize(.small)
    .padding(.horizontal, 8)
    .frame(height: 28)
  }

  private func stepButton(_ label: String, _ icon: String, forward: Bool, enabled: Bool)
    -> some View
  {
    Button { model.stepSearch(forward: forward) } label: { Image(systemName: icon) }
      .buttonStyle(.borderless)
      .disabled(!enabled)
      .help(label)
      .accessibilityLabel(label)
  }

  /// Up/down walk the visible rows; left/right collapse and expand.
  private func navigate(_ key: KeyEquivalent, rows: [Inspection.Node]) -> Bool {
    guard let selected = model.selectedId, let index = rows.firstIndex(where: { $0.id == selected })
    else {
      guard key == .upArrow || key == .downArrow else { return false }
      model.select(root.id)
      return true
    }
    let node = rows[index]
    switch key {
    case .downArrow: model.select(rows[min(index + 1, rows.count - 1)].id)
    case .upArrow: model.select(rows[max(index - 1, 0)].id)
    case .leftArrow: model.expanded.remove(node.id)
    case .rightArrow: if !node.isLeaf { model.expanded.insert(node.id) }
    default: return false
    }
    return true
  }
}

private struct TreeRow: View {
  @Environment(\.theme) private var theme
  let model: InspectionModel
  let node: Inspection.Node
  let level: Int
  let open: Bool
  let query: String

  var body: some View {
    let selected = model.selectedId == node.id
    let isMatch = !query.isEmpty && node.matches(query)
    HStack(spacing: 4) {
      if node.isLeaf {
        Color.clear.frame(width: 12)
      } else {
        Button {
          if open { model.expanded.remove(node.id) } else { model.expanded.insert(node.id) }
        } label: {
          Image(systemName: Icon.chevronRight)
            .font(.scaled(size: 9, weight: .semibold))
            .rotationEffect(.degrees(open ? 90 : 0))
            .frame(width: 12, height: 12)
        }
        .buttonStyle(.plain)
        .foregroundStyle(theme.textMuted)
        .accessibilityLabel(open ? "Collapse" : "Expand")
      }
      // A button rather than a tap gesture: those drop the first click into
      // a window that isn't key.
      Button(action: click) {
        HStack(spacing: 4) {
          Text(highlight(node.className, isMatch: isMatch))
            .foregroundStyle(theme.text)
          if let label = node.label {
            Text(highlight("“\(label)”", isMatch: isMatch))
              .foregroundStyle(theme.textMuted)
              .lineLimit(1)
          }
          Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
    }
    .font(.scaled(size: 11, design: .monospaced))
    .padding(.leading, 6 + CGFloat(level) * 12)
    .padding(.trailing, 8)
    .frame(height: 20)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(selected ? theme.accentSoft : Color.clear)
    .opacity(!query.isEmpty && !isMatch ? 0.45 : 1)
    .contentShape(Rectangle())
    .id(node.id)
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
  }

  private func click() {
    if NSApp.currentEvent?.clickCount == 2 {
      model.focus(node.id)
    } else {
      model.select(node.id)
      if !node.isLeaf { model.expanded.insert(node.id) }
    }
  }

  /// The first case-insensitive hit, marked.
  private func highlight(_ text: String, isMatch: Bool) -> AttributedString {
    var out = AttributedString(text)
    guard isMatch, let range = out.range(of: query, options: .caseInsensitive) else { return out }
    out[range].backgroundColor = theme.warningSoft
    out[range].foregroundColor = theme.text
    return out
  }
}
