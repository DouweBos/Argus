import ArgusCore
import SwiftUI

/// Open a pull request for a session's branch: title, a description started
/// from the repo's template (or filled in by Claude), draft, then push the
/// branch and open it. The computer works out the base and head from the session.
public struct OpenPullRequestSheet: View {
  @Environment(PullRequestsStore.self) private var store
  @Environment(HostStore.self) private var host
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL

  /// More than one offers a picker; empty means just `sessionId`.
  let choices: [RemoteSession]
  let defaultTitle: String
  let onOpened: (String) -> Void

  @State private var sessionId: String
  @State private var title = ""
  @State private var summary = ""
  @State private var draft: Bool
  @State private var busy: String?
  @State private var error: String?
  @State private var createdURL: String?
  @State private var confirming = false

  public init(
    sessionId: String, choices: [RemoteSession] = [], defaultTitle: String = "", draft: Bool = true,
    onOpened: @escaping (String) -> Void = { _ in }
  ) {
    self.choices = choices
    self.defaultTitle = defaultTitle
    self.onOpened = onOpened
    _sessionId = State(initialValue: sessionId)
    _draft = State(initialValue: draft)
  }

  private var session: RemoteSession? {
    choices.first { $0.id == sessionId }
      ?? host.sessionsByRepo.values.lazy.flatMap { $0 }.first { $0.id == sessionId }
  }

  private var trimmedTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }
  private var canOpen: Bool { busy == nil && session != nil && !trimmedTitle.isEmpty }

  public var body: some View {
    content
      .confirmationDialog("Open this pull request?", isPresented: $confirming, titleVisibility: .visible) {
        Button(draft ? "Push and Open Draft" : "Push and Open") { open() }
        Button("Cancel", role: .cancel) {}
      } message: {
        Text("\(session?.branch ?? "The branch") is pushed, then a PR into \(session?.baseBranch ?? "its base") is opened as you.")
      }
      .task(id: sessionId) {
        if title.isEmpty { title = defaultTitle }
        if summary.isEmpty, let template = await store.template(sessionId: sessionId), summary.isEmpty {
          summary = template
        }
      }
  }

  private var branches: String? {
    session.map { "\($0.branch) → \($0.baseBranch ?? "base")" }
  }

  private func fill() {
    guard let session else { return }
    busy = "Filling in…"
    error = nil
    Task {
      defer { busy = nil }
      do {
        if let draft = try await store.fill(
          sessionId: session.id, title: trimmedTitle.isEmpty ? session.branch : trimmedTitle)
        {
          summary = draft.body ?? summary
          // A title the user typed stays; the branch-name default doesn't.
          if let drafted = draft.title, trimmedTitle.isEmpty || title == defaultTitle || title == session.branch {
            title = drafted
          }
        } else {
          error = "Claude couldn't fill in the description. Check that `claude` is installed and signed in on the computer."
        }
      } catch {
        self.error = "Couldn't fill in the description — \(HostStore.describe(error))"
      }
    }
  }

  private func open() {
    guard let session else { return }
    error = nil
    Task {
      defer { busy = nil }
      busy = "Pushing…"
      host.clearError()
      guard await host.push(sessionId: session.id) != nil else {
        error = "Couldn't push \(session.branch)" + (host.lastError.map { " — \($0)" } ?? "")
        return
      }
      busy = "Opening…"
      if let url = await store.create(sessionId: session.id, title: trimmedTitle, body: summary, draft: draft) {
        createdURL = url
        onOpened(url)
      } else {
        error = store.error
      }
    }
  }

  private func openOnGitHub(_ url: String) {
    if let link = URL(string: url) { openURL(link) }
  }

  // MARK: - Layout

  #if os(macOS)
    private var content: some View {
      Form {
        if let createdURL {
          Section {
            Label("Pull request opened", systemImage: Icon.check).font(.scaled(.headline))
            Text(createdURL).font(.scaled(size: 12, design: .monospaced)).textSelection(.enabled)
            HStack {
              Button(PullRequestLabels.openOn(createdURL)) { openOnGitHub(createdURL) }
              Button("Copy Link") { Clipboard.copy(createdURL) }
            }
          }
        } else {
          Section {
            if choices.count > 1 {
              Picker("Session", selection: $sessionId) {
                ForEach(choices, id: \.id) { Text($0.displayName ?? $0.branch).tag($0.id) }
              }
            }
            if let branches { LabeledContent("Branches", value: branches) }
            TextField("Title", text: $title, prompt: Text("Pull request title"))
            Toggle("Open as draft", isOn: $draft)
          }
          Section {
            TextEditor(text: $summary)
              .font(.scaled(size: 12, design: .monospaced))
              .frame(minHeight: 180)
          } header: {
            HStack {
              Text("Description")
              Spacer()
              Button("Fill In with Claude") { fill() }
                .buttonStyle(.argusBorderless)
                .controlSize(.small)
                .disabled(busy != nil || session == nil)
            }
          }
        }
        if let error {
          Text(error).foregroundStyle(.secondary).textSelection(.enabled)
        }
      }
      .formStyle(.grouped)
      .toggleStyle(.argusSwitch)
      .safeAreaInset(edge: .top) {
        Text("New Pull Request").font(.scaled(.headline)).frame(maxWidth: .infinity, alignment: .leading)
          .padding([.top, .horizontal], 20)
      }
      .frame(width: 560, height: createdURL == nil ? 560 : 260)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(createdURL == nil ? "Cancel" : "Done") { dismiss() }
        }
        if createdURL == nil {
          ToolbarItem(placement: .confirmationAction) {
            Button(busy ?? "Open Pull Request") { confirming = true }.disabled(!canOpen)
          }
        }
      }
    }
  #else
    private var content: some View {
      NavigationStack {
        Screen {
          if let createdURL {
            Card(tone: .success) {
              SectionHeader(title: "Pull request opened")
              MutedText(createdURL, lineLimit: 2).textSelection(.enabled)
              FlowRow(spacing: 8) {
                Btn(label: PullRequestLabels.openOn(createdURL), small: true, icon: Icon.openExternal, hugs: true) {
                  openOnGitHub(createdURL)
                }
                Btn(label: "Copy link", tone: .secondary, small: true, icon: Icon.copy, hugs: true) {
                  Clipboard.copy(createdURL)
                }
              }
            }
          } else {
            fields
          }
          if let error { Banner(text: error, tone: .danger).textSelection(.enabled) }
        }
        .sheetTitle("New pull request")
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button(createdURL == nil ? "Cancel" : "Done") { dismiss() }
          }
        }
      }
    }

    @ViewBuilder private var fields: some View {
      Field(label: "Pull request", caption: branches) {
        if choices.count > 1 {
          Picker("Session", selection: $sessionId) {
            ForEach(choices, id: \.id) { Text($0.displayName ?? $0.branch).tag($0.id) }
          }
        }
        ThemedTextField(placeholder: "Title", text: $title)
        Toggle("Open as a draft", isOn: $draft)
          .font(.scaled(size: 14))
          .toggleStyle(.argusSwitch)
      }
      Field(label: "Description") {
        ThemedTextField(placeholder: "What changed and why", text: $summary, multiline: true, lines: 4...14)
        Btn(
          label: busy == "Filling in…" ? "Filling in…" : "Fill in with Claude", tone: .secondary, small: true,
          icon: Icon.agent, hugs: true
        ) { fill() }
        .disabled(busy != nil || session == nil)
      }
      Btn(label: busy ?? (draft ? "Push and open draft" : "Push and open")) { confirming = true }
        .disabled(!canOpen)
    }
  #endif
}
