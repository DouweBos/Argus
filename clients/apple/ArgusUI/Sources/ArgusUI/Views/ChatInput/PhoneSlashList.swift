import SwiftUI

/// The phone's slash-command menu: name, argument hint and description per row.
struct PhoneSlashList: View {
  @Environment(\.theme) private var theme
  let commands: [SlashCommandMenu.Command]
  let pick: (SlashCommandMenu.Command) -> Void

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(commands) { command in
          Button {
            pick(command)
          } label: {
            VStack(alignment: .leading, spacing: 1) {
              HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("/\(command.name)").font(.scaled(size: 14)).foregroundStyle(theme.text)
                if !command.argumentHint.isEmpty {
                  Text(command.argumentHint)
                    .font(.scaled(size: 12))
                    .foregroundStyle(theme.textMuted)
                    .lineLimit(1)
                }
              }
              if !command.description.isEmpty {
                Text(command.description)
                  .font(.scaled(size: 11))
                  .foregroundStyle(theme.textMuted)
                  .lineLimit(1)
              }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
          }
          .buttonStyle(.argusPlain)
        }
      }
    }
    .frame(maxHeight: 190)
    .padding(.horizontal, 8)
    .background(theme.bgTertiary)
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
  }
}
