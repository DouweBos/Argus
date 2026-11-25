import ArgusCore
import ArgusUI
import SwiftUI

/// `/projects/clone`: clone a repository into a new project on the computer.
/// The folder is a path on the computer, so it offers the remembered one and
/// where the other projects live rather than a file picker. Lands on the
/// project once it's cloned.
///
/// Needs control: it clones onto the computer's disk.
struct CloneRepositoryView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router

  private let initialURL: String
  private let initialCloneId: String?
  @State private var model: CloneRepositoryModel?

  init(url: String = "", cloneId: String? = nil) {
    initialURL = url
    initialCloneId = cloneId
  }

  var body: some View {
    Group {
      if let model {
        if let job = model.job {
          progress(model, job)
        } else {
          CloneRepositoryForm(model: model)
        }
      } else {
        Loading(label: "Reading the computer's folders")
      }
    }
    .navigationTitle("Clone Repository")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if let model, model.job == nil, host.hasControl {
        ToolbarItem(placement: .confirmationAction) {
          Button(model.starting ? "Cloning" : "Clone") { Task { await model.start(source: .ios) } }
            .disabled(!model.canStart)
        }
      }
    }
    .task(id: ObjectIdentifier(host)) {
      // A new computer is a new form; the old one asked a host that is gone.
      if model?.host !== host {
        let next = CloneRepositoryModel(host: host, cloneId: initialCloneId)
        next.url = initialURL
        model = next
      }
      await model?.load()
    }
  }

  @ViewBuilder
  private func progress(_ model: CloneRepositoryModel, _ job: CloneRepositoryModel.Job) -> some View {
    Screen {
      CloneProgressView(job: job)
      switch job.status {
      case .running:
        Btn(label: "Cancel", tone: .secondary, small: true, icon: Icon.close) { Task { await model.cancel() } }
          .disabled(!host.hasControl)
      case .failed, .cancelled:
        Btn(label: "Try Again", tone: .secondary, small: true, icon: Icon.refresh) { model.retry() }
      default:
        Btn(label: "Open Project", small: true) { open(job) }
      }
    }
    .task(id: job.id) { await model.watch() }
    .onChange(of: job.status) { _, status in
      guard status == .done else { return }
      Task {
        await host.refreshProjects()
        open(job)
      }
    }
  }

  /// Swaps this screen for the project, so back skips a finished flow.
  private func open(_ job: CloneRepositoryModel.Job) {
    guard case .cloneRepository = router.frontRoute else { return }
    let name = URL(fileURLWithPath: job.path).lastPathComponent
    router.replaceTop(with: .project(repoRoot: job.path, name: name), dropping: 1)
  }
}

/// The address, the folder and the name, checked by the computer as you type.
private struct CloneRepositoryForm: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Bindable var model: CloneRepositoryModel

  var body: some View {
    List {
      if let error = model.error {
        Banner(text: error, tone: .danger).listRowBackground(Color.clear)
      }
      Section {
        TextField("Repository", text: $model.url, prompt: prompt("https://github.com/owner/repo"))
          .font(.scaled(size: 15, design: .monospaced))
          .keyboardType(.URL)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
      } header: {
        Text("Repository")
      } footer: {
        Text(addressHint)
      }
      Section {
        ForEach(model.parentChoices, id: \.self) { folder in
          Button {
            model.parentDir = folder
          } label: {
            HStack(spacing: 10) {
              Image(systemName: Icon.folder).foregroundStyle(theme.textSecondary)
              Text(folder).font(.scaled(size: 14, design: .monospaced)).lineLimit(1).truncationMode(.middle)
                .foregroundStyle(theme.text)
              Spacer()
              if folder == model.parentDir {
                Image(systemName: Icon.check).foregroundStyle(theme.accent)
              }
            }
          }
        }
        TextField("Another folder", text: $model.parentDir, prompt: prompt("/Users/you/Developer"))
          .font(.scaled(size: 14, design: .monospaced))
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
      } header: {
        Text("Folder on the computer")
      }
      Section {
        TextField("Name", text: $model.name, prompt: prompt(model.suggestedName.isEmpty ? "repo" : model.suggestedName))
          .font(.scaled(size: 15, design: .monospaced))
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
      } header: {
        Text("Folder name")
      } footer: {
        if let problem = model.preview?.problem {
          Text(problem).foregroundStyle(theme.error)
        } else if let path = model.preview?.path, !path.isEmpty {
          Text("Clones into \(path) and adds it as a project.")
        }
      }
    }
    .scrollDismissesKeyboard(.interactively)
    .disabled(!host.hasControl)
    .task(id: "\(model.url)|\(model.parentDir)|\(model.name)") {
      try? await Task.sleep(for: .milliseconds(250))
      guard !Task.isCancelled else { return }
      await model.refreshPreview()
    }
  }

  private var addressHint: String {
    let shorthand = model.defaults?.ghAvailable == true ? "owner/repo clones with gh" : "owner/repo clones from GitHub"
    return "An https URL, an ssh address like git@github.com:owner/repo.git, or owner/repo — \(shorthand)."
  }

  private func prompt(_ text: String) -> Text {
    Text(text).foregroundStyle(theme.textMuted)
  }
}
