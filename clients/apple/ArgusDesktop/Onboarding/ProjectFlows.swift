import ArgusCore
import ArgusUI
import SwiftUI

/// First-run onboarding and adding a project, presented over the main window.
struct ProjectFlows: ViewModifier {
  @Environment(DesktopModel.self) private var model
  @State private var onboarding = OnboardingModel()
  @State private var adding: RepoPath?

  func body(content: Content) -> some View {
    content
      .sheet(isPresented: onboardingVisible) {
        OnboardingView(onboarding: onboarding).interactiveDismissDisabled()
      }
      .sheet(item: $adding) { repo in
        AddProjectSheet(path: repo.path)
      }
      // On a ready connection: the backend exists before its socket does, and
      // a request made in between fails without a retry.
      .task(id: model.store.connection == .ready) {
        guard model.store.connection == .ready, let backend = model.backend, !onboarding.loaded
        else { return }
        PrereqChecks.shared.listen(model.store)
        await onboarding.load(backend)
      }
      .onChange(of: model.addingProject) { _, isAdding in
        guard isAdding else { return }
        model.addingProject = false
        Task {
          if let path = await model.pickFolder() { adding = RepoPath(path: HostScopedPath.scope(path, on: model.hosts.focused)) }
        }
      }
      #if DEBUG
        // The dev driver can't click through an open panel; it names the folder.
        .onReceive(NotificationCenter.default.publisher(for: .devAddProject)) { note in
          if let path = note.object as? String { adding = RepoPath(path: path) }
        }
      #endif
  }

  private var onboardingVisible: Binding<Bool> {
    Binding(get: { onboarding.visible }, set: { _ in })
  }
}

#if DEBUG
  extension Notification.Name {
    static let devAddProject = Notification.Name("argus.dev.addProject")
  }
#endif

/// Add Project: register the folder, offer a `.argus.json` when it has none,
/// then open it.
private struct AddProjectSheet: View {
  let path: String
  @Environment(DesktopModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  @State private var generator: ArgusJsonGenerator?
  @State private var error: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Add Project").font(.scaled(.title2).weight(.semibold))
        Label(URL(fileURLWithPath: path).lastPathComponent, systemImage: "folder.fill")
          .foregroundStyle(theme.textSecondary)
          .help(path)
      }
      if let error {
        Text(error).foregroundStyle(theme.error).textSelection(.enabled)
      } else if let generator {
        ScrollView { ArgusJsonReviewView(generator: generator).frame(maxWidth: .infinity, alignment: .leading) }
      } else {
        ProgressView("Adding…").frame(maxWidth: .infinity)
      }
      HStack {
        Spacer()
        Button(generator == nil ? "Close" : "Not now") { dismiss() }
          .keyboardShortcut(.cancelAction)
          .disabled(generator?.isBusy == true)
        if generator != nil {
          Button("Open Project") {
            dismiss()
            Task { await model.openProjectRoot(path) }
          }
          .buttonStyle(.borderedProminent)
          .keyboardShortcut(.defaultAction)
          .disabled(generator?.isBusy == true)
        }
      }
    }
    .padding(24)
    .frame(width: 560)
    .frame(minHeight: 260)
    .task {
      guard let backend = model.backend else { return }
      do {
        try await ProjectRegistration.add(path, source: .openPanel, backend)
        generator = ArgusJsonGenerator(repoRoot: path)
      } catch {
        self.error = HostStore.describe(error)
      }
    }
  }
}

extension DesktopModel {
  /// Open a project and land on its root session's home.
  func openProjectRoot(_ repoRoot: String) async {
    await openProject(repoRoot)
    let sessions = store.sessionsByRepo[repoRoot] ?? []
    if let root = sessions.first(where: { $0.kind == .projectRoot }) ?? sessions.first {
      navigate(.sessionHome(id: root.id))
    }
  }
}
