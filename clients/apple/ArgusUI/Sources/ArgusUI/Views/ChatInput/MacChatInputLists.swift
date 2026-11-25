#if os(macOS)
  import SwiftUI

  /// A keyboard-driven list floating above the input; the highlighted row follows ↑/↓
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
      // Opaque: it floats over the chat or the start title, which must not show through.
      .background(theme.surface)
      .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
      .overlay {
        RoundedRectangle(cornerRadius: theme.radiusSmall).strokeBorder(theme.border, lineWidth: 1)
      }
      // It floats over the chat, as the context card does.
      .shadow(color: .black.opacity(theme.scheme == .dark ? 0.35 : 0.08), radius: 12, y: 4)
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
    var files: [PendingFile] = []
    var removeElement: (UUID) -> Void = { _ in }
    var removeFile: (UUID) -> Void = { _ in }
    /// Nil: the chips show their notes read-only.
    var setNote: ((UUID, String) -> Void)?
    let remove: (UUID) -> Void

    public init(
      images: [PendingImage], elements: [PickedElement] = [], files: [PendingFile] = [],
      removeElement: @escaping (UUID) -> Void = { _ in }, removeFile: @escaping (UUID) -> Void = { _ in },
      setNote: ((UUID, String) -> Void)? = nil, remove: @escaping (UUID) -> Void
    ) {
      self.images = images
      self.elements = elements
      self.files = files
      self.removeElement = removeElement
      self.removeFile = removeFile
      self.setNote = setNote
      self.remove = remove
    }

    public var body: some View {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
          ForEach(elements) { element in
            removable(help: "Remove element", action: { removeElement(element.id) }) {
              PickedElementChip(element: element, setNote: setNote.map { set in { set(element.id, $0) } })
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
          ForEach(files) { file in
            removable(help: "Remove file", action: { removeFile(file.id) }) {
              PendingFileChip(file: file).help(file.path ?? file.name)
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

  /// A picked element in the composer: its crop, what it is, where it came from and a note for the agent.
  struct PickedElementChip: View {
    @Environment(\.theme) private var theme
    let element: PickedElement
    var setNote: ((String) -> Void)?

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
        .frame(width: 52, height: 52)
        .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall - 2))
        VStack(alignment: .leading, spacing: 3) {
          Text(element.title)
            .font(.scaled(size: 12, design: .monospaced))
            .foregroundStyle(theme.text)
            .lineLimit(1)
            .truncationMode(.middle)
            .help(element.context)
          Label(element.source == .browser ? "Browser element" : "Simulator element",
                systemImage: element.source == .browser ? Icon.web : Icon.simulator)
            .font(.scaled(size: 10))
            .foregroundStyle(theme.textMuted)
            .lineLimit(1)
          note
        }
        .frame(width: 200, alignment: .leading)
      }
      .padding(6)
      .frame(height: 64)
      .background(theme.surface, in: .rect(cornerRadius: theme.radiusSmall))
      .overlay {
        RoundedRectangle(cornerRadius: theme.radiusSmall).strokeBorder(theme.border, lineWidth: 1)
      }
      .accessibilityElement(children: .contain)
      .accessibilityLabel("Picked element \(element.title)")
    }

    @ViewBuilder private var note: some View {
      if let setNote {
        TextField("Add a note", text: Binding(get: { element.note }, set: setNote))
          .textFieldStyle(.plain)
          .font(.scaled(size: 11))
          .foregroundStyle(theme.text)
          .padding(.horizontal, 5)
          .padding(.vertical, 2)
          .background(theme.bgTertiary, in: .rect(cornerRadius: 4))
          .accessibilityLabel("Note for \(element.title)")
      } else if !element.note.isEmpty {
        Text(element.note)
          .font(.scaled(size: 11))
          .foregroundStyle(theme.textSecondary)
          .lineLimit(1)
      }
    }
  }
#endif
