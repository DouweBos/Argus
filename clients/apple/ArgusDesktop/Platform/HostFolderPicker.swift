import ArgusCore
import ArgusUI
import SwiftUI

/// A folder pick waiting on the user: on this Mac an open panel, on a paired
/// host this sheet, which walks that host's disk over the wire — an open
/// panel would browse the wrong machine.
struct HostFolderRequest: Identifiable {
  let id = UUID()
  let host: HostId
  let prompt: String
  let start: String?
  let done: (String?) -> Void
}

extension DesktopModel {
  /// A folder on `host` (the focused machine when nil), as that machine
  /// spells it; nil when cancelled.
  func pickFolder(prompt: String = "Add Project", on host: HostId? = nil, start: String? = nil) async
    -> String?
  {
    let host = host ?? hosts.focused
    guard host != Hosts.local else { return await FolderPicker.pick(prompt: prompt) }
    MacTelemetry.capture(.hostFolderPicked(stage: .opened))
    return await withCheckedContinuation { continuation in
      hostFolderRequest = HostFolderRequest(host: host, prompt: prompt, start: start) { path in
        MacTelemetry.capture(.hostFolderPicked(stage: path == nil ? .cancelled : .picked))
        continuation.resume(returning: path)
      }
    }
  }
}

struct HostFolderPicker: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  let request: HostFolderRequest

  @State private var listing: ArgusProtocol.HostDirectoryListing?
  @State private var selected: String?
  @State private var loading = true
  @State private var error: String?
  @State private var answered = false

  private var target: String? { selected ?? listing?.path }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Folders on \(model.hosts.label(request.host))")
        .font(.scaled(.headline))
      HStack(spacing: 6) {
        Button {
          if let parent = listing?.parent { Task { await load(parent) } }
        } label: {
          Image(systemName: "chevron.up")
        }
        .disabled(listing?.parent == nil)
        .help("Enclosing folder")
        .accessibilityLabel("Enclosing folder")
        Button {
          Task { await load(nil) }
        } label: {
          Image(systemName: "house")
        }
        .help("Home folder")
        .accessibilityLabel("Home folder")
        Text(listing?.path ?? "…")
          .font(.system(.callout, design: .monospaced))
          .foregroundStyle(theme.textSecondary)
          .lineLimit(1)
          .truncationMode(.head)
      }
      // Buttons rather than a selectable list: they take the first click even
      // while the sheet isn't key, as every other control here does.
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          ForEach(listing?.entries ?? [], id: \.path) { entry in
            HStack(spacing: 6) {
              Button {
                selected = entry.path
              } label: {
                Label {
                  Text(entry.name).frame(maxWidth: .infinity, alignment: .leading)
                } icon: {
                  Image(systemName: entry.isRepo ? "folder.badge.gearshape" : "folder")
                    .foregroundStyle(entry.isRepo ? theme.accent : theme.textSecondary)
                }
                .contentShape(.rect)
              }
              .buttonStyle(.argusPlain)
              .accessibilityLabel(entry.name)
              Button {
                Task { await load(entry.path) }
              } label: {
                Image(systemName: "chevron.right")
              }
              .buttonStyle(.argusBorderless)
              .help("Open \(entry.name)")
              .accessibilityLabel("Open \(entry.name)")
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(selected == entry.path ? theme.accentSoft : .clear, in: .rect(cornerRadius: theme.radiusSmall))
          }
        }
      }
      .background(theme.bgSecondary, in: .rect(cornerRadius: theme.radiusSmall))
      .overlay {
        if loading {
          ProgressView().controlSize(.small)
        } else if let error {
          Text(error).foregroundStyle(theme.error).padding()
        } else if listing?.entries.isEmpty == true {
          Text("No folders here.").foregroundStyle(theme.textMuted)
        }
      }
      .frame(minHeight: 280)
      HStack {
        Spacer()
        Button("Cancel") { finish(nil) }
          .keyboardShortcut(.cancelAction)
        Button(request.prompt) { finish(target) }
          .keyboardShortcut(.defaultAction)
          .buttonStyle(.borderedProminent)
          .disabled(target == nil)
      }
    }
    .padding(20)
    .frame(width: 520, height: 460)
    .task { await load(request.start) }
    .onDisappear { if !answered { request.done(nil) } }
  }

  private func load(_ path: String?) async {
    guard let backend = model.backend else { return }
    loading = true
    error = nil
    do {
      let next = try await HostRouter.$pinned.withValue(request.host) {
        try await backend.request(ArgusProtocol.Commands.ListHostDirectory.self, .init(path: path))
      }
      listing = next
      selected = nil
    } catch {
      self.error = HostStore.describe(error)
    }
    loading = false
  }

  private func finish(_ path: String?) {
    answered = true
    request.done(path)
    dismiss()
  }
}
