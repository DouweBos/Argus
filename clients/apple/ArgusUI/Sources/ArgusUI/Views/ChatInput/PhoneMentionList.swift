import SwiftUI

/// The phone's `@` menu: matching directories then files, or one directory's
/// entries while browsing, led by "Link" for the directory itself.
struct PhoneMentionList: View {
  @Environment(\.theme) private var theme
  let header: String
  let items: [MentionPicker.Item]
  let pick: (MentionPicker.Item) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(header)
        .font(.scaled(size: 10, weight: .bold))
        .foregroundStyle(theme.textMuted)
        .lineLimit(1)
        .truncationMode(.head)
        .padding(.top, 6)
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(items) { item in
            Button {
              pick(item)
            } label: {
              row(item)
            }
            .buttonStyle(.argusPlain)
          }
        }
      }
      .frame(maxHeight: 190)
    }
    .padding(.horizontal, 8)
    .padding(.bottom, 4)
    .background(theme.bgTertiary)
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
  }

  private func row(_ item: MentionPicker.Item) -> some View {
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
        .font(.scaled(size: 14))
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
          .font(.scaled(size: 10, weight: .semibold))
          .foregroundStyle(theme.textMuted)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.vertical, 6)
    .contentShape(Rectangle())
  }
}
