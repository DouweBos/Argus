import ArgusCore
import ArgusKit
import ArgusUI
import Observation
import SwiftUI

/// Scanning Claude Code CLI history for projects and adding the picked ones;
/// shared by the import sheet and the first-run project step.
@MainActor
@Observable
final class CliProjectPicker {
  let source: ArgusProtocol.CliProjectImportSource
  private(set) var scan: ArgusProtocol.CliProjectScan?
  private(set) var scannedAt = Date()
  private(set) var importing = false
  var picked: Set<String> = []
  var error: String?

  init(source: ArgusProtocol.CliProjectImportSource) {
    self.source = source
  }

  var suggestions: [ArgusProtocol.CliProjectCandidate] { CliProjectImport.suggestions(scan) }

  func load(_ backend: HostRouter) async {
    guard scan == nil else { return }
    do {
      let result = try await backend.request(ArgusProtocol.Commands.ScanCliProjects.self, .init(source: source))
      scannedAt = Date()
      picked = CliProjectImport.defaultSelection(result.candidates, now: scannedAt)
      scan = result
    } catch {
      self.error = HostStore.describe(error)
    }
  }

  /// The most recently used of the picked projects, opened after onboarding imports them.
  var mostRecentPicked: String? { CliProjectImport.mostRecent(picked, in: scan?.candidates ?? []) }

  /// Adds the picked projects; false (with `error` set) when the host refused.
  func importPicked(_ backend: HostRouter) async -> Bool {
    let paths = picked
    importing = true
    defer { importing = false }
    do {
      _ = try await backend.request(
        ArgusProtocol.Commands.ImportCliProjects.self, .init(paths: Array(paths), source: source))
      for path in paths {
        _ = try? await backend.request(ArgusProtocol.Commands.OnboardingRegisterProject.self, .init(path: path))
      }
      return true
    } catch {
      self.error = HostStore.describe(error)
      return false
    }
  }
}

/// The picker's rows: name, path, chat count and last use, with select all / none.
struct CliProjectList: View {
  @Bindable var picker: CliProjectPicker
  /// Already-added projects show greyed out in the sheet; onboarding leaves them out.
  var showsAdded = true
  /// Off when the list already sits inside a scroll view, so it grows with the page.
  var scrolls = true
  @Environment(\.theme) private var theme

  var body: some View {
    let selectable = picker.suggestions
    let rows = showsAdded ? (picker.scan?.candidates ?? []) : selectable
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("\(picker.picked.count) of \(selectable.count) selected").foregroundStyle(theme.textMuted)
        Spacer()
        Button("Select all") { picker.picked = Set(selectable.map(\.path)) }.buttonStyle(.accentLink)
        Button("Select none") { picker.picked = [] }.buttonStyle(.accentLink)
      }
      .font(.scaled(.caption))
      Group {
        if scrolls {
          ScrollView { rowStack(rows) }
        } else {
          rowStack(rows)
        }
      }
      .background(theme.surface, in: RoundedRectangle(cornerRadius: theme.radiusSmall + 2))
      .overlay(RoundedRectangle(cornerRadius: theme.radiusSmall + 2).strokeBorder(theme.border))
      if picker.scan?.truncated == true {
        Text("Only the newest chats were scanned; some projects may be missing.")
          .font(.scaled(.caption))
          .foregroundStyle(theme.textMuted)
      }
    }
  }

  private func rowStack(_ rows: [ArgusProtocol.CliProjectCandidate]) -> some View {
    LazyVStack(alignment: .leading, spacing: 0) {
      ForEach(rows, id: \.path) { candidate in
        if candidate.path != rows.first?.path { SettingsHairline() }
        row(candidate)
      }
    }
  }

  private func row(_ candidate: ArgusProtocol.CliProjectCandidate) -> some View {
    Toggle(isOn: binding(candidate)) {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 2) {
          Text(candidate.name).fontWeight(.semibold).lineLimit(1)
          Text(candidate.path)
            .font(.scaled(.caption).monospaced())
            .foregroundStyle(theme.textMuted)
            .lineLimit(1)
            .truncationMode(.middle)
            .help(candidate.path)
        }
        Spacer(minLength: 8)
        if candidate.added {
          Text("Added").foregroundStyle(theme.textMuted)
        } else {
          Text(CliProjectImport.chatCount(candidate.chatCount)).foregroundStyle(theme.textMuted)
          Text(CliProjectImport.shortAge(sinceMs: candidate.lastActiveAt, now: picker.scannedAt))
            .foregroundStyle(theme.textMuted)
            .frame(minWidth: 28, alignment: .trailing)
        }
      }
      .font(.scaled(.body))
      .monospacedDigit()
    }
    .toggleStyle(.checkbox)
    .disabled(candidate.added || picker.importing)
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
  }

  private func binding(_ candidate: ArgusProtocol.CliProjectCandidate) -> Binding<Bool> {
    Binding(
      get: { candidate.added || picker.picked.contains(candidate.path) },
      set: { on in
        if on { picker.picked.insert(candidate.path) } else { picker.picked.remove(candidate.path) }
      })
  }
}
