import ArgusCore
import ArgusUI
import SwiftUI

/// The projects a run may read, one form row each — shared by the automation
/// editor and Quick Run so both pick scope the same way.
struct ProjectScopeSection: View {
  @Environment(HostStore.self) private var host
  @Binding var selection: [String]
  var footer = "Repos the run may read."

  var body: some View {
    Section {
      if host.projects.isEmpty, host.projectsLoaded { Text("No projects are open.").foregroundStyle(.secondary) }
      ForEach(host.projects) { project in
        Toggle(isOn: membership(project.repoRoot, in: $selection)) {
          Label(project.name, systemImage: "folder")
        }
        .help(HostScopedPath.path(project.repoRoot))
      }
    } header: {
      ScopeHeader(
        title: "Projects", ids: host.projects.map(\.repoRoot), selection: $selection)
    } footer: {
      Text(footer)
    }
  }
}

/// The signal sources feeding a run its work.
struct SourceScopeSection: View {
  @Environment(AutomationsStore.self) private var store
  @Binding var selection: [String]

  var body: some View {
    Section {
      if store.sources.isEmpty { Text("None reported.").foregroundStyle(.secondary) }
      ForEach(store.sources) { source in
        Toggle(isOn: membership(source.id, in: $selection)) {
          Text(source.label)
          if !source.available { Text("Not configured") }
        }
      }
    } header: {
      ScopeHeader(title: "Signal sources", ids: store.sources.map(\.id), selection: $selection)
    } footer: {
      Text("What feeds the run its work.")
    }
  }
}

/// A monospaced playbook editor with a placeholder while it's empty.
struct PlaybookEditor: View {
  @Binding var text: String
  var placeholder: String?
  var minHeight: CGFloat = 220

  var body: some View {
    TextEditor(text: $text)
      .font(.system(.body, design: .monospaced))
      .scrollContentBackground(.hidden)
      .frame(minHeight: minHeight)
      .overlay(alignment: .topLeading) {
        if let placeholder, text.isEmpty {
          Text(placeholder)
            .font(.system(.body, design: .monospaced))
            .foregroundStyle(.tertiary)
            .padding(.leading, 5)
            .allowsHitTesting(false)
        }
      }
  }
}

/// "n of m" plus a one-click Select All / Clear, so a long list isn't sixteen clicks.
private struct ScopeHeader: View {
  let title: String
  let ids: [String]
  @Binding var selection: [String]

  var body: some View {
    let picked = ids.filter(selection.contains).count
    HStack {
      Text(title)
      Spacer()
      if ids.count > 1 {
        Button(picked == ids.count ? "Clear" : "Select All") {
          if picked == ids.count {
            selection.removeAll { ids.contains($0) }
          } else {
            selection.append(contentsOf: ids.filter { !selection.contains($0) })
          }
        }
        .buttonStyle(.argusBorderless)
        .controlSize(.small)
      }
      if !ids.isEmpty { Text("\(picked) of \(ids.count)").monospacedDigit().foregroundStyle(.secondary) }
    }
  }
}

private func membership(_ value: String, in selection: Binding<[String]>) -> Binding<Bool> {
  Binding(
    get: { selection.wrappedValue.contains(value) },
    set: { on in
      selection.wrappedValue.removeAll { $0 == value }
      if on { selection.wrappedValue.append(value) }
    })
}
