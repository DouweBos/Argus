import ArgusCore
import SwiftUI

/// One model: its four rates and a mapping, with Reset to automatic. A table
/// row on the Mac, a card of fields on the phone.
struct UsagePriceRowEditor: View {
  @Environment(\.theme) private var theme
  @Binding var row: UsagePriceDraft.Row
  let canEdit: Bool
  let onReset: () -> Void

  static let rateWidth: CGFloat = 84
  static let modelWidth: CGFloat = 230
  static let resetWidth: CGFloat = 150

  /// The Mac table's column labels.
  static var header: some View {
    HeaderRow()
  }

  private struct HeaderRow: View {
    @Environment(\.theme) private var theme

    var body: some View {
      HStack(spacing: 8) {
        label("Model").frame(width: UsagePriceRowEditor.modelWidth, alignment: .leading)
        ForEach(["Input", "Output", "Cache read", "Cache write"], id: \.self) {
          label($0).frame(width: UsagePriceRowEditor.rateWidth, alignment: .leading)
        }
        label("Map to").frame(maxWidth: .infinity, alignment: .leading)
        Color.clear.frame(width: UsagePriceRowEditor.resetWidth, height: 1)
      }
    }

    private func label(_ text: String) -> some View {
      Text(text).font(.scaled(size: 11, weight: .medium)).foregroundStyle(theme.textMuted)
    }
  }

  var body: some View {
    #if os(macOS)
      HStack(spacing: 8) {
        VStack(alignment: .leading, spacing: 3) {
          modelName
          Badge(label: status, tone: badgeTone)
        }
        .frame(width: Self.modelWidth, alignment: .leading)
        rates.frame(width: Self.rateWidth * 4 + 24)
        UsagePriceField(placeholder: "Count as another model", text: $row.mapTo, mono: true)
          .disabled(!canEdit || row.resetting)
        ZStack(alignment: .trailing) { resetButton }.frame(width: Self.resetWidth, alignment: .trailing)
      }
      .opacity(row.resetting ? 0.6 : 1)
    #else
      VStack(alignment: .leading, spacing: 10) {
        HStack(spacing: 8) {
          modelName
          Badge(label: status, tone: badgeTone)
        }
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 8, alignment: .top)], alignment: .leading, spacing: 8) {
          labelled("Input") { rate(\.input, list: row.list?.input, fallback: "Required") }
          labelled("Output") { rate(\.output, list: row.list?.output, fallback: "Required") }
          labelled("Cache read") { rate(\.cacheRead, list: row.list?.cacheRead, fallback: "Input rate") }
          labelled("Cache write") { rate(\.cacheWrite, list: row.list?.cacheWrite, fallback: "Input rate") }
        }
        .disabled(!canEdit || row.resetting)
        labelled("Map to") { UsagePriceField(placeholder: "Count as another model", text: $row.mapTo, mono: true) }
          .disabled(!canEdit || row.resetting)
        // Below the fields: beside the name it wraps on a phone.
        resetButton.frame(maxWidth: .infinity, alignment: .trailing)
      }
      .opacity(row.resetting ? 0.6 : 1)
    #endif
  }

  private var modelName: some View {
    Text(row.model)
      .font(.scaled(size: 13, weight: .semibold, design: .monospaced))
      .foregroundStyle(theme.text)
      .lineLimit(1)
      .truncationMode(.middle)
      .textSelection(.enabled)
  }

  private var rates: some View {
    HStack(spacing: 8) {
      rate(\.input, list: row.list?.input, fallback: "Required")
      rate(\.output, list: row.list?.output, fallback: "Required")
      rate(\.cacheRead, list: row.list?.cacheRead, fallback: "Input")
      rate(\.cacheWrite, list: row.list?.cacheWrite, fallback: "Input")
    }
    .disabled(!canEdit || row.resetting)
  }

  @ViewBuilder
  private var resetButton: some View {
    if canEdit && (row.isSet || row.resetting) {
      Btn(
        label: row.resetting ? "Undo" : "Reset to automatic", tone: .ghost, small: true,
        icon: row.resetting ? Icon.undo : nil, hugs: true, action: onReset)
    }
  }

  private var badgeTone: Tone { row.resetting ? .warning : row.isSet ? .accent : .muted }

  private var status: String {
    if row.resetting { return "Resets to automatic" }
    if row.isMapped { return "Mapped" }
    if row.isSet { return "Custom" }
    return row.list == nil ? "No price" : "List price"
  }

  /// A rate field; a mapped model's rates don't apply, so they're off.
  private func rate(_ field: WritableKeyPath<UsagePriceDraft.Row, String>, list: Double?, fallback: String) -> some View {
    UsagePriceField(
      placeholder: list.map { "$" + UsagePriceDraft.text($0) } ?? fallback, text: $row[dynamicMember: field],
      decimal: true
    )
    .disabled(row.isMapped)
    .opacity(row.isMapped ? 0.5 : 1)
  }

  private func labelled(_ label: String, @ViewBuilder field: () -> some View) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(label)
        .font(.scaled(size: 11, weight: .medium))
        .foregroundStyle(theme.textMuted)
      field()
    }
  }
}

/// A price editor field: the Mac's compact bordered field, the phone's themed one.
struct UsagePriceField: View {
  let placeholder: String
  @Binding var text: String
  var mono = false
  var decimal = false
  var onSubmit: (() -> Void)?

  var body: some View {
    #if os(macOS)
      TextField(placeholder, text: $text)
        .textFieldStyle(.roundedBorder)
        .font(.scaled(size: 12, design: mono ? .monospaced : nil).monospacedDigit())
        .autocorrectionDisabled()
        .onSubmit { onSubmit?() }
    #else
      ThemedTextField(
        placeholder: placeholder, text: $text, keyboard: decimal ? .decimalPad : .default, mono: mono, input: .code,
        onSubmit: onSubmit)
    #endif
  }
}
