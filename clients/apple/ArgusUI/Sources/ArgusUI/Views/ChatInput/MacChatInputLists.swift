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
            .font(.system(size: 10, weight: .bold))
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
                .buttonStyle(.plain)
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
            .font(.system(size: 13, design: .monospaced))
            .foregroundStyle(theme.text)
            .fixedSize()
          if !command.argumentHint.isEmpty {
            Text(command.argumentHint)
              .font(.system(size: 12, design: .monospaced))
              .foregroundStyle(theme.textMuted)
              .lineLimit(1)
              .layoutPriority(-1)
          }
          if !command.description.isEmpty {
            Text(command.description)
              .font(.system(size: 12))
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
          Image(systemName: icon(item))
            .font(.system(size: 11))
            .foregroundStyle(theme.textMuted)
            .frame(width: 14)
          Text(item.isLinkAction ? "Link \(item.display)" : item.display)
            .font(.system(size: 13))
            .foregroundStyle(item.isLinkAction ? theme.accent : theme.text)
            .lineLimit(1)
          if let hint = item.hint, !hint.isEmpty {
            Text(hint)
              .font(.system(size: 11))
              .foregroundStyle(theme.textMuted)
              .lineLimit(1)
              .truncationMode(.head)
          }
          Spacer(minLength: 0)
          if item.isDirectory, !item.isLinkAction {
            Image(systemName: Icon.chevronRight)
              .font(.system(size: 9, weight: .semibold))
              .foregroundStyle(theme.textMuted)
          }
        }
      }
    }

    private func icon(_ item: MentionPicker.Item) -> String {
      if item.isLinkAction { return Icon.link }
      return item.isDirectory ? Icon.folder : Icon.file
    }
  }

  struct AttachmentStrip: View {
    @Environment(\.theme) private var theme
    let images: [PendingImage]
    let remove: (UUID) -> Void

    var body: some View {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
          ForEach(images) { image in
            Image(platformImage: image.preview)
              .resizable()
              .scaledToFill()
              .frame(width: 56, height: 56)
              .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
              .overlay {
                RoundedRectangle(cornerRadius: theme.radiusSmall)
                  .strokeBorder(theme.border, lineWidth: 1)
              }
              .overlay(alignment: .topTrailing) {
                Button {
                  remove(image.id)
                } label: {
                  Image(systemName: Icon.close)
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(theme.onAccent)
                    .padding(4)
                    .background(Circle().fill(theme.accent))
                }
                .buttonStyle(.plain)
                .help("Remove image")
                .offset(x: 5, y: -5)
              }
          }
        }
        .padding(.top, 6)
        .padding(.trailing, 6)
      }
    }
  }
#endif
