import ArgusCore
import ArgusUI
import SwiftUI

/// Clone Repository: an address, a folder and a name, checked by the host as
/// they're typed, then the clone's progress. Once cloned it offers a project
/// config the way Add Project does, then opens the project.
struct CloneRepositorySheet: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme

  private let initialURL: String
  private let initialCloneId: String?
  @State private var clone: CloneRepositoryModel?
  @State private var generator: ArgusJsonGenerator?

  init(url: String = "", cloneId: String? = nil) {
    initialURL = url
    initialCloneId = cloneId
  }

  var body: some View {
    VStack(spacing: 0) {
      if let generator, let path = clone?.job?.path {
        configure(generator, path: path)
      } else {
        Text("Clone Repository").font(.scaled(.title2).weight(.semibold))
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding([.horizontal, .top], 24)
        Form {
          if let clone {
            if let job = clone.job {
              Section { CloneProgressView(job: job) }
            } else {
              CloneRepositoryFields(clone: clone)
            }
            if let error = clone.error, clone.job == nil {
              Section { Text(error).foregroundStyle(theme.error).textSelection(.enabled) }
            }
          }
        }
        .formStyle(.grouped)
        footer
      }
    }
    // A Form has no height of its own; the review scrolls inside the taller one.
    .frame(width: 560, height: generator == nil ? (clone?.job == nil ? 440 : 280) : 620)
    .task(id: ObjectIdentifier(model.store)) {
      if clone?.host !== model.store {
        let next = CloneRepositoryModel(host: model.store, cloneId: initialCloneId)
        next.url = initialURL
        clone = next
      }
      await clone?.load()
    }
    // Live events keep the clone current; polling covers a missed one.
    .task(id: clone?.cloneId) { await clone?.watch() }
    .onChange(of: clone?.job?.status) { _, status in
      guard status == .done, let path = clone?.job?.path else { return }
      Task { await model.store.refreshProjects() }
      generator = ArgusJsonGenerator(repoRoot: path)
    }
  }

  private func configure(_ generator: ArgusJsonGenerator, path: String) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Cloned").font(.scaled(.title2).weight(.semibold))
        Label(URL(fileURLWithPath: path).lastPathComponent, systemImage: "folder.fill")
          .foregroundStyle(theme.textSecondary)
          .help(path)
      }
      ScrollView { ArgusJsonReviewView(generator: generator).frame(maxWidth: .infinity, alignment: .leading) }
      HStack {
        Spacer()
        Button("Not now") { dismiss() }
          .keyboardShortcut(.cancelAction)
          .disabled(generator.isBusy)
        Button("Open Project") {
          dismiss()
          Task { await model.openProjectRoot(path) }
        }
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.defaultAction)
        .disabled(generator.isBusy)
      }
    }
    .padding(24)
  }

  @ViewBuilder
  private var footer: some View {
    HStack {
      if let clone, let job = clone.job {
        switch job.status {
        case .running:
          Button("Cancel Clone", role: .destructive) { Task { await clone.cancel() } }
          Spacer()
          Button("Hide") { dismiss() }
            .keyboardShortcut(.cancelAction)
            .help("The clone carries on; the project shows in the sidebar once it's done")
        case .failed, .cancelled:
          Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
          Spacer()
          Button("Edit and Retry") { clone.retry() }.keyboardShortcut(.defaultAction)
        default:
          Spacer()
          ProgressView().controlSize(.small)
        }
      } else {
        Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
        Spacer()
        Button(clone?.starting == true ? "Cloning" : "Clone") {
          Task { await clone?.start(source: .mac) }
        }
        .keyboardShortcut(.defaultAction)
        .disabled(clone?.canStart != true)
      }
    }
    .padding()
  }
}

/// The address, folder and name, previewed by the host as they change.
private struct CloneRepositoryFields: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  @Bindable var clone: CloneRepositoryModel

  var body: some View {
    Section {
      TextField("Repository", text: $clone.url, prompt: Text("https://github.com/owner/repo"))
        .font(.system(.body, design: .monospaced))
    } footer: {
      Text(addressHint)
    }
    Section {
      LabeledContent("Folder") {
        HStack(spacing: 6) {
          Picker("Folder", selection: $clone.parentDir) {
            ForEach(clone.parentChoices, id: \.self) { Text($0).tag($0) }
          }
          .labelsHidden()
          Button("Choose") {
            Task {
              if let picked = await model.pickFolder(prompt: "Clone Here", start: clone.parentDir) {
                clone.parentDir = picked
              }
            }
          }
        }
      }
      TextField(
        "Name", text: $clone.name, prompt: Text(clone.suggestedName.isEmpty ? "repo" : clone.suggestedName)
      )
      .font(.system(.body, design: .monospaced))
    } footer: {
      if let problem = clone.preview?.problem {
        Text(problem).foregroundStyle(theme.error)
      } else if let path = clone.preview?.path, !path.isEmpty {
        Text("Clones into \(path) and adds it as a project.")
      }
    }
    .task(id: "\(clone.url)|\(clone.parentDir)|\(clone.name)") {
      try? await Task.sleep(for: .milliseconds(250))
      guard !Task.isCancelled else { return }
      await clone.refreshPreview()
    }
  }

  private var addressHint: String {
    let shorthand = clone.defaults?.ghAvailable == true ? "owner/repo clones with gh" : "owner/repo clones from GitHub"
    return "An https URL, an ssh address like git@github.com:owner/repo.git, or owner/repo — \(shorthand)."
  }
}
