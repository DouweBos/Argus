import ArgusCore
import SwiftUI

/// What keeping a slot does: how it lands and whether the other slots go.
/// The Mac's sheet and the phone's both show this, so the choice reads the same.
public struct CompareKeepForm: View {
  @Environment(\.theme) private var theme
  @Binding var landing: CompareLanding
  @Binding var deleteOthers: Bool
  let runner: String
  let others: Int
  /// The base branch is protected, so merging isn't on offer.
  let canMerge: Bool

  public init(
    landing: Binding<CompareLanding>, deleteOthers: Binding<Bool>, runner: String, others: Int,
    canMerge: Bool = true
  ) {
    _landing = landing
    _deleteOthers = deleteOthers
    self.runner = runner
    self.others = others
    self.canMerge = canMerge
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text("Keep \(runner)'s work").font(.scaled(size: 15, weight: .semibold)).foregroundStyle(theme.text)
      VStack(alignment: .leading, spacing: 4) {
        ForEach(CompareLanding.allCases.filter { canMerge || $0 != .merge }, id: \.self) { option in
          Button {
            landing = option
          } label: {
            HStack(spacing: 8) {
              Image(systemName: landing == option ? "largecircle.fill.circle" : "circle")
                .foregroundStyle(landing == option ? theme.accent : theme.textMuted)
              Text(option.label).font(.scaled(size: 13)).foregroundStyle(theme.text)
              Spacer(minLength: 0)
            }
            .padding(.vertical, 5)
            .contentShape(Rectangle())
          }
          .buttonStyle(.argusPlain)
          .accessibilityAddTraits(landing == option ? .isSelected : [])
        }
      }
      Toggle(isOn: $deleteOthers) {
        VStack(alignment: .leading, spacing: 2) {
          Text(others == 1 ? "Delete the other slot" : "Delete the other \(others) slots")
            .font(.scaled(size: 13))
          Text("Their worktrees, branches and agents go, teardown included.")
            .font(.scaled(size: 11)).foregroundStyle(theme.textSecondary)
        }
      }
      .tint(theme.switchTint)
    }
  }
}
