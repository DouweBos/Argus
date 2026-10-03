import AppKit
import ArgusUI
import SwiftUI

/// Live-edit controls for the bridge's whitelisted properties. Each keeps a
/// draft so typing is smooth, commits on Return / focus loss, and re-syncs to
/// whatever the device reports after the re-inspect — `PropertyEditors.tsx`.
/// Callers give each editor `.id(nodeId)` so a new selection starts fresh.

struct InspectionTextEdit: View {
  let value: String
  let commit: (String) -> Void
  @State private var draft = ""
  /// Return then focus loss would otherwise send the same edit twice.
  @State private var sent: String?
  @FocusState private var focused: Bool

  var body: some View {
    TextField("", text: $draft)
      .textFieldStyle(.roundedBorder)
      .focused($focused)
      .onSubmit(send)
      .onExitCommand {
        draft = value
        focused = false
      }
      .onChange(of: focused) { _, now in if !now { send() } }
      .onChange(of: value, initial: true) { _, next in
        draft = next
        sent = nil
      }
  }

  private func send() {
    guard draft != value, draft != sent else { return }
    sent = draft
    commit(draft)
  }
}

struct InspectionNumberEdit: View {
  let value: Double
  var range: ClosedRange<Double>?
  let commit: (String) -> Void
  @State private var draft = ""
  @State private var sent: String?
  @FocusState private var focused: Bool

  var body: some View {
    TextField("", text: $draft)
      .textFieldStyle(.roundedBorder)
      .font(.system(size: 11).monospacedDigit())
      .frame(maxWidth: 80)
      .focused($focused)
      .onSubmit(send)
      .onExitCommand {
        draft = Inspection.format(value)
        focused = false
      }
      .onChange(of: focused) { _, now in if !now { send() } }
      .onChange(of: value, initial: true) { _, next in
        draft = Inspection.format(next)
        sent = nil
      }
  }

  private func send() {
    guard var n = Double(draft.trimmingCharacters(in: .whitespaces)), n != value else {
      draft = Inspection.format(value)
      return
    }
    if let range { n = min(max(n, range.lowerBound), range.upperBound) }
    let text = Inspection.format(n)
    guard text != sent else { return }
    sent = text
    commit(text)
  }
}

/// A system color well plus the hex. The well streams changes while dragging,
/// so commits are debounced.
struct InspectionColorEdit: View {
  let value: String
  let commit: (String) -> Void
  @State private var draft = ""
  @State private var pending: Task<Void, Never>?

  private var color: Binding<Color> {
    Binding(
      get: { Inspection.RGBA(hex: draft).map(Color.init(rgba:)) ?? .clear },
      set: { next in
        guard let rgba = Self.rgba(next) else { return }
        draft = rgba.hex
        pending?.cancel()
        pending = Task {
          try? await Task.sleep(for: .milliseconds(350))
          guard !Task.isCancelled else { return }
          send()
        }
      })
  }

  var body: some View {
    HStack(spacing: 6) {
      ColorPicker("", selection: color, supportsOpacity: true)
        .labelsHidden()
        .fixedSize()
      TextField("", text: $draft)
        .textFieldStyle(.roundedBorder)
        .font(.system(size: 11, design: .monospaced))
        .frame(maxWidth: 100)
        .onSubmit(send)
        .onExitCommand { draft = value }
    }
    .onChange(of: value, initial: true) { _, next in draft = next }
  }

  private func send() {
    let hex = draft.hasPrefix("#") ? draft : "#\(draft)"
    guard let rgba = Inspection.RGBA(hex: hex) else {
      draft = value
      return
    }
    if rgba != Inspection.RGBA(hex: value) { commit(rgba.hex) }
  }

  private static func rgba(_ color: Color) -> Inspection.RGBA? {
    guard let ns = NSColor(color).usingColorSpace(.sRGB) else { return nil }
    return Inspection.RGBA(
      red: ns.redComponent, green: ns.greenComponent, blue: ns.blueComponent,
      alpha: ns.alphaComponent)
  }
}

struct InspectionBoolEdit: View {
  let value: Bool
  let commit: (String) -> Void

  var body: some View {
    Toggle(
      "", isOn: Binding(get: { value }, set: { commit($0 ? "true" : "false") })
    )
    .toggleStyle(.switch)
    .controlSize(.mini)
    .labelsHidden()
  }
}

/// A read-only color: swatch and hex.
struct InspectionColorSwatch: View {
  @Environment(\.theme) private var theme
  let hex: String

  var body: some View {
    HStack(spacing: 6) {
      RoundedRectangle(cornerRadius: 3)
        .fill(Inspection.RGBA(hex: hex).map(Color.init(rgba:)) ?? .clear)
        .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(theme.border))
        .frame(width: 14, height: 14)
      Text(hex).font(.system(size: 11, design: .monospaced))
    }
  }
}
