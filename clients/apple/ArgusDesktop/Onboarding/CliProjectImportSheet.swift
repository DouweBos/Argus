import ArgusCore
import ArgusKit
import ArgusUI
import SwiftUI

/// Import projects from Claude Code: the directories the CLI has chats for,
/// ticked to add as projects. Their chats then import into history.
struct CliProjectImportSheet: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  @State private var scan: ArgusProtocol.CliProjectScan?
  @State private var error: String?
  @State private var picked: Set<String> = []
  @State private var importing = false
  @State private var scannedAt = Date()

  private var selectable: [ArgusProtocol.CliProjectCandidate] {
    (scan?.candidates ?? []).filter { !$0.added }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Import projects from Claude Code").font(.scaled(.title2).weight(.semibold))
        Text("Projects you've used the Claude Code CLI in, with how many chats each has.")
          .foregroundStyle(theme.textSecondary)
      }
      content.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      HStack {
        Spacer()
        Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
        Button(CliProjectImport.importLabel(picked.count)) { Task { await runImport() } }
          .buttonStyle(.borderedProminent)
          .keyboardShortcut(.defaultAction)
          .disabled(picked.isEmpty || importing)
      }
    }
    .padding(24)
    .frame(width: 600, height: 520)
    .task { await load() }
  }

  @ViewBuilder private var content: some View {
    if let error {
      Text(error).foregroundStyle(theme.error).textSelection(.enabled)
    } else if let scan {
      if scan.candidates.isEmpty {
        Text("No Claude Code projects found")
          .foregroundStyle(theme.textMuted)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        list(scan)
      }
    } else {
      ProgressView("Looking through your Claude Code chats…").frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  private func list(_ scan: ArgusProtocol.CliProjectScan) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("\(picked.count) of \(selectable.count) selected").foregroundStyle(theme.textMuted)
        Spacer()
        Button("Select all") { picked = Set(selectable.map(\.path)) }.buttonStyle(.accentLink)
        Button("Select none") { picked = [] }.buttonStyle(.accentLink)
      }
      .font(.scaled(.caption))
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 2) {
          ForEach(scan.candidates, id: \.path) { row($0) }
        }
      }
      .background(theme.bgSecondary, in: RoundedRectangle(cornerRadius: theme.radiusSmall))
      if scan.truncated {
        Text("Only the newest chats were scanned; some projects may be missing.")
          .font(.scaled(.caption))
          .foregroundStyle(theme.textMuted)
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
          Text(CliProjectImport.shortAge(sinceMs: candidate.lastActiveAt, now: scannedAt))
            .foregroundStyle(theme.textMuted)
            .frame(minWidth: 28, alignment: .trailing)
        }
      }
      .font(.scaled(.body))
      .monospacedDigit()
    }
    .toggleStyle(.checkbox)
    .disabled(candidate.added || importing)
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
  }

  private func binding(_ candidate: ArgusProtocol.CliProjectCandidate) -> Binding<Bool> {
    Binding(
      get: { candidate.added || picked.contains(candidate.path) },
      set: { on in
        if on { picked.insert(candidate.path) } else { picked.remove(candidate.path) }
      })
  }

  private func load() async {
    guard let backend = model.backend else { return }
    do {
      let result = try await backend.request(ArgusProtocol.Commands.ScanCliProjects.self, .init())
      scannedAt = Date()
      picked = CliProjectImport.defaultSelection(result.candidates, now: scannedAt)
      scan = result
    } catch {
      self.error = HostStore.describe(error)
    }
  }

  private func runImport() async {
    guard let backend = model.backend else { return }
    importing = true
    do {
      _ = try await backend.request(
        ArgusProtocol.Commands.ImportCliProjects.self, .init(paths: Array(picked)))
      dismiss()
    } catch {
      self.error = HostStore.describe(error)
      importing = false
    }
  }
}
