import ArgusCore
import SwiftUI

/// The inbox's filter: which automation and which project, with how much each
/// has waiting.
public struct InboxFilterMenu: View {
  let options: InboxFilterOptions
  let filter: InboxFilter
  let onChange: (InboxFilter, InboxFilterField) -> Void

  public init(
    options: InboxFilterOptions, filter: InboxFilter,
    onChange: @escaping (InboxFilter, InboxFilterField) -> Void
  ) {
    self.options = options
    self.filter = filter
    self.onChange = onChange
  }

  public var body: some View {
    Menu {
      Section("Automation") {
        Picker("Automation", selection: binding(\.automationId, .automation)) {
          Text("All Automations").tag(String?.none)
          ForEach(options.automations) { option in
            Text("\(option.label) (\(option.count))").tag(Optional(option.value))
          }
        }
        .pickerStyle(.inline)
      }
      if !options.projects.isEmpty || filter.project != nil {
        Section("Project") {
          Picker("Project", selection: binding(\.project, .project)) {
            Text("All Projects").tag(String?.none)
            ForEach(options.projects) { option in
              Text("\(option.label) (\(option.count))").tag(Optional(option.value))
            }
          }
          .pickerStyle(.inline)
        }
      }
      if !filter.isEmpty {
        Divider()
        Button("Clear Filters") { onChange(.all, .clear) }
      }
    } label: {
      if filter.isEmpty {
        Label("Filter", systemImage: Icon.filter)
      } else {
        Label(summary, systemImage: Icon.filterActive).labelStyle(.titleAndIcon)
      }
    }
    .menuIndicator(.hidden)
    .clickable()
    .help("Show one automation's or one project's items")
    .accessibilityLabel(filter.isEmpty ? "Filter" : "Filtered: \(summary)")
  }

  private var summary: String { options.summary(filter) }

  private func binding(_ key: WritableKeyPath<InboxFilter, String?>, _ field: InboxFilterField) -> Binding<String?> {
    Binding(
      get: { filter[keyPath: key] },
      set: { value in
        var next = filter
        next[keyPath: key] = value
        if next != filter { onChange(next, field) }
      })
  }
}
