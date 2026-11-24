import ArgusKit
import ArgusCore
import SwiftUI

/// A teammate's colour and symbol, picked from the fixed sets the host accepts.
/// No symbol shows its initials.
public struct TeammateLookPicker: View {
  @Environment(\.theme) private var theme
  let name: String
  @Binding var color: ArgusProtocol.TeammateColor
  @Binding var symbol: ArgusProtocol.TeammateSymbol?

  public init(
    name: String, color: Binding<ArgusProtocol.TeammateColor>, symbol: Binding<ArgusProtocol.TeammateSymbol?>
  ) {
    self.name = name
    self._color = color
    self._symbol = symbol
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      FlowRow(spacing: 10, rowSpacing: 10, packed: true) {
        ForEach(TeammateDraft.colors, id: \.self) { option in
          Button {
            color = option
          } label: {
            Circle()
              .fill(TeammateAvatar.tint(option))
              .frame(width: 26, height: 26)
              .overlay { selectionRing(option == color, size: 34) }
              .frame(width: 34, height: 34)
          }
          .buttonStyle(.argusPlain)
          .accessibilityLabel(option.rawValue.capitalized)
          .accessibilityAddTraits(option == color ? .isSelected : [])
        }
      }
      FlowRow(spacing: 8, rowSpacing: 8, packed: true) {
        face(nil)
        ForEach(TeammateDraft.symbols, id: \.self) { face($0) }
      }
    }
  }

  private func face(_ option: ArgusProtocol.TeammateSymbol?) -> some View {
    let avatar: ArgusProtocol.TeammateAvatar =
      option.map { .symbol(.init(kind: "symbol", symbol: $0)) } ?? .initials(.init(kind: "initials"))
    return Button {
      symbol = option
    } label: {
      TeammateAvatar(name: name.isEmpty ? "?" : name, color: color, avatar: avatar, size: 34)
        .overlay { selectionRing(option == symbol, size: 42) }
        .frame(width: 42, height: 42)
    }
    .buttonStyle(.argusPlain)
    .accessibilityLabel(option.map { $0.rawValue } ?? "Initials")
    .accessibilityAddTraits(option == symbol ? .isSelected : [])
  }

  @ViewBuilder
  private func selectionRing(_ selected: Bool, size: CGFloat) -> some View {
    if selected {
      Circle().strokeBorder(theme.text, lineWidth: 2).frame(width: size, height: size)
    }
  }
}
