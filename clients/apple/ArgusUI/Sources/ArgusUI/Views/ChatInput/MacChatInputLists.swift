#if os(macOS)
  import SwiftUI

  /// A keyboard-driven list above the input; the highlighted row follows ↑/↓
  /// and stays scrolled into view.
  private struct SuggestionList<Item: Identifiable, Row: View>: View {
    @Environment(\.theme) private var theme
    var header: String?
    let items: [Item]
    let selected: Int
    let pick: (Item) -> Void
    @ViewBuilder let row: (Item) -> Row

    var body: some View {
      VStack(alignment: .leading, spacing: 0) {
        if let header {
          Text(header)
            .font(.scaled(size: 10, weight: .bold))
            .foregroundStyle(theme.textMuted)
            .lineLimit(1)
            .truncationMode(.head)
            .padding(.horizontal, 10)
            .padding(.top, 6)
            .padding(.bottom, 2)
        }
        ScrollViewReader { proxy in
          ScrollView {
            VStack(alignment: .leading, spacing: 0) {
              ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                Button {
                  pick(item)
                } label: {
                  row(item)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(
                      index == selected
                        ? theme.accent.opacity(0.18) : Color.clear,
                      in: .rect(cornerRadius: theme.radiusSmall)
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.argusPlain)
                .id(index)
              }
            }
            .padding(4)
          }
          .onChange(of: selected) { _, index in proxy.scrollTo(index) }
        }
        .frame(maxHeight: 220)
        .fixedSize(horizontal: false, vertical: true)
      }
      .background(theme.bgTertiary)
      .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
      .overlay {
        RoundedRectangle(cornerRadius: theme.radiusSmall).strokeBorder(theme.border, lineWidth: 1)
      }
    }
  }

  struct SlashSuggestionList: View {
    @Environment(\.theme) private var theme
    let items: [SlashCommandMenu.Command]
    let selected: Int
    let pick: (SlashCommandMenu.Command) -> Void

    var body: some View {
      SuggestionList(items: items, selected: selected, pick: pick) { command in
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text("/\(command.name)")
            .font(.scaled(size: 13, design: .monospaced))
            .foregroundStyle(theme.text)
            // Truncated, not fixed: a plugin's long command name would otherwise
            // widen the whole column and push the sidebar off the window.
            .lineLimit(1)
            .truncationMode(.middle)
            .layoutPriority(1)
          if !command.argumentHint.isEmpty {
            Text(command.argumentHint)
              .font(.scaled(size: 12, design: .monospaced))
              .foregroundStyle(theme.textMuted)
              .lineLimit(1)
              .layoutPriority(-1)
          }
          if !command.description.isEmpty {
            Text(command.description)
              .font(.scaled(size: 12))
              .foregroundStyle(theme.textMuted)
              .lineLimit(1)
          }
        }
      }
    }
  }

  struct MentionSuggestionList: View {
    @Environment(\.theme) private var theme
    let header: String
    let items: [MentionPicker.Item]
    let selected: Int
    let pick: (MentionPicker.Item) -> Void

    var body: some View {
      SuggestionList(header: header, items: items, selected: selected, pick: pick) { item in
        HStack(spacing: 6) {
          Group {
            if item.isLinkAction {
              Image(systemName: Icon.link).font(.scaled(size: 11)).foregroundStyle(theme.textMuted)
            } else {
              FileTypeIcon(path: item.display, isDirectory: item.isDirectory, size: 14)
            }
          }
          .frame(width: 14)
          Text(item.isLinkAction ? "Link \(item.display)" : item.display)
            .font(.scaled(size: 13))
            .foregroundStyle(item.isLinkAction ? theme.accent : theme.text)
            .lineLimit(1)
          if let hint = item.hint, !hint.isEmpty {
            Text(hint)
              .font(.scaled(size: 11))
              .foregroundStyle(theme.textMuted)
              .lineLimit(1)
              .truncationMode(.head)
          }
          Spacer(minLength: 0)
          if item.isDirectory, !item.isLinkAction {
            Image(systemName: Icon.chevronRight)
              .font(.scaled(size: 9, weight: .semibold))
              .foregroundStyle(theme.textMuted)
          }
        }
      }
    }
  }

  /// The composer's picked elements and images, each with a remove button.
  public struct AttachmentStrip: View {
    @Environment(\.theme) private var theme
    let images: [PendingImage]
    var elements: [PickedElement] = []
    var removeElement: (UUID) -> Void = { _ in }
    let remove: (UUID) -> Void

    public init(
      images: [PendingImage], elements: [PickedElement] = [], removeElement: @escaping (UUID) -> Void = { _ in },
      remove: @escaping (UUID) -> Void
    ) {
      self.images = images
      self.elements = elements
      self.removeElement = removeElement
      self.remove = remove
    }

    public var body: some View {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
          ForEach(elements) { element in
            removable(help: "Remove element", action: { removeElement(element.id) }) {
              PickedElementChip(element: element)
            }
          }
          ForEach(images) { image in
            removable(help: "Remove image", action: { remove(image.id) }) {
              Image(platformImage: image.preview)
                .resizable()
                .scaledToFill()
                .frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
                .overlay {
                  RoundedRectangle(cornerRadius: theme.radiusSmall)
                    .strokeBorder(theme.border, lineWidth: 1)
                }
            }
          }
        }
      }
    }

    // The button stays inside the item's frame: offset past it, the next
    // item took its clicks, so only the last one could be removed.
    private func removable(
      help: String, action: @escaping () -> Void, @ViewBuilder content: () -> some View
    ) -> some View {
      ZStack(alignment: .topTrailing) {
        content()
          .padding(.top, 6)
          .padding(.trailing, 6)
        Button(action: action) {
          Image(systemName: Icon.close)
            .font(.scaled(size: 8, weight: .bold))
            .foregroundStyle(theme.onAccent)
            .padding(4)
            .background(Circle().fill(theme.accent))
            .contentShape(Circle())
        }
        .buttonStyle(.argusPlain)
        .help(help)
        .offset(x: 1, y: 1)
      }
    }
  }

  /// A picked element in the composer: its crop, what it is and where it came from.
  struct PickedElementChip: View {
    @Environment(\.theme) private var theme
    let element: PickedElement

    private var preview: PlatformImage? {
      element.crop.flatMap { Data(base64Encoded: $0.data) }.flatMap(PlatformImage.init(data:))
    }

    var body: some View {
      HStack(spacing: 8) {
        ZStack {
          theme.bgTertiary
          if let preview {
            Image(platformImage: preview).resizable().scaledToFit()
          } else {
            Image(systemName: Icon.elementPick).foregroundStyle(theme.textMuted)
          }
        }
        .frame(width: 44, height: 44)
        .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall - 2))
        VStack(alignment: .leading, spacing: 2) {
          Text(element.title)
            .font(.scaled(size: 12, design: .monospaced))
            .foregroundStyle(theme.text)
            .lineLimit(1)
            .truncationMode(.middle)
          Label(element.source == .browser ? "Browser element" : "Simulator element",
                systemImage: element.source == .browser ? Icon.web : Icon.simulator)
            .font(.scaled(size: 10))
            .foregroundStyle(theme.textMuted)
            .lineLimit(1)
        }
        .frame(maxWidth: 180, alignment: .leading)
      }
      .padding(6)
      .frame(height: 56)
      .background(theme.surface, in: .rect(cornerRadius: theme.radiusSmall))
      .overlay {
        RoundedRectangle(cornerRadius: theme.radiusSmall).strokeBorder(theme.border, lineWidth: 1)
      }
      .help(element.context)
      .accessibilityElement(children: .combine)
      .accessibilityLabel("Picked element \(element.title)")
    }
  }
#endif
