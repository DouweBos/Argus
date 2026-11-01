import SwiftUI

/// A short multi-select picked in place: one switch per option, the Mac's
/// project and source toggles. `selection` keeps the order things were turned on.
public struct ToggleList: View {
  public struct Option: Identifiable {
    public var id: String
    public var label: String
    public var hint: String?

    public init(id: String, label: String, hint: String? = nil) {
      self.id = id
      self.label = label
      self.hint = hint
    }
  }

  let options: [Option]
  @Binding var selection: [String]
  var emptyMessage: String?

  public init(options: [Option], selection: Binding<[String]>, emptyMessage: String? = nil) {
    self.options = options
    self._selection = selection
    self.emptyMessage = emptyMessage
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if options.isEmpty, let emptyMessage { MutedText(emptyMessage) }
      ForEach(options) { option in
        Toggle(isOn: member(option.id)) {
          VStack(alignment: .leading, spacing: 1) {
            Text(option.label).font(.scaled(size: 15)).lineLimit(1)
            if let hint = option.hint { MutedText(hint).lineLimit(1) }
          }
        }
        .toggleStyle(.argusSwitch)
      }
    }
  }

  private func member(_ id: String) -> Binding<Bool> {
    Binding(
      get: { selection.contains(id) },
      set: { selection = Self.toggled(selection, id, on: $0) })
  }

  static func toggled(_ selection: [String], _ id: String, on: Bool) -> [String] {
    var next = selection.filter { $0 != id }
    if on { next.append(id) }
    return next
  }
}

#Preview("ToggleList") {
  @Previewable @State var picked = ["argus"]
  ToggleList(
    options: [
      .init(id: "argus", label: "Argus"),
      .init(id: "web", label: "Website", hint: "not configured"),
    ],
    selection: $picked
  )
  .padding()
}
