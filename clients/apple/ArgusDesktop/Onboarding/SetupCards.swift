import ArgusCore
import ArgusUI
import SwiftUI

/// The home screen's environment cards: only what's wrong with the four core
/// checks, each with the fix it has.
struct SetupCards: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.openSettings) private var openSettings
  private var checks: PrereqChecks { .shared }

  var body: some View {
    VStack(spacing: 8) {
      ForEach(Array(checks.cards.enumerated()), id: \.offset) { _, card in
        cardView(card)
      }
    }
    .task(id: model.store.connection == .ready) {
      guard model.store.connection == .ready, let backend = model.backend else { return }
      checks.listen(model.store)
      await checks.run(backend)
    }
  }

  @ViewBuilder private func cardView(_ card: SetupChecks.Card) -> some View {
    switch card {
    case .claudeCliMissing(let fixable, let detail):
      SetupCard(
        tone: .danger, title: "Claude Code CLI not installed.",
        text: "Agents can't run without it. \(detail ?? "")"
      ) {
        if fixable {
          Button(checks.fixing == .claudeCli ? "Installing…" : "Install") { fix(.claudeCli) }
            .disabled(checks.fixing != nil)
        } else {
          recheck
        }
      }
    case .claudeAuth(let copy):
      SetupCard(tone: .warning, title: copy.headline, text: copy.body) {
        Button(checks.running ? "Checking…" : "Re-check") { run([.claudeAuth]) }.disabled(checks.running)
        Button(copy.action) {
          model.settingsTab = .accounts
          openSettings()
        }
        .buttonStyle(.borderedProminent)
      }
    case .gitMissing(let detail):
      SetupCard(
        tone: .danger, title: "Git not found.",
        text: "Sessions are git worktrees, so git is required. \(detail ?? "")"
      ) { recheck }
    case .gitIdentity:
      SetupCard(
        tone: .warning, title: "Git identity not configured.",
        text: "Commits agents make won't have an author until you set a name and email."
      ) {
        EmptyView()
      } below: {
        GitIdentityForm(busy: checks.fixing == .gitIdentity) { name, email in
          guard let backend = model.backend else { return }
          Task { await checks.fix(backend, .gitIdentity, gitName: name, gitEmail: email) }
        }
      }
    }
  }

  private var recheck: some View {
    Button(checks.running ? "Checking…" : "Re-check") { run(SetupChecks.core) }.disabled(checks.running)
  }

  private func run(_ ids: [PrereqId]) {
    guard let backend = model.backend else { return }
    Task { await checks.run(backend, ids: ids, force: true) }
  }

  private func fix(_ id: PrereqId) {
    guard let backend = model.backend else { return }
    Task { await checks.fix(backend, id) }
  }
}

/// A toned card with a bold lead line and its actions.
struct SetupCard<Actions: View, Below: View>: View {
  let tone: Tone
  let title: String
  let text: String
  @ViewBuilder var actions: Actions
  @ViewBuilder var below: Below
  @Environment(\.theme) private var theme

  init(
    tone: Tone, title: String, text: String, @ViewBuilder actions: () -> Actions,
    @ViewBuilder below: () -> Below = { EmptyView() }
  ) {
    self.tone = tone
    self.title = title
    self.text = text
    self.actions = actions()
    self.below = below()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .center, spacing: 10) {
        (Text(title).bold().foregroundStyle(tone.color(theme)) + Text(" ") + Text(text).foregroundStyle(theme.text))
          .font(.system(size: 13))
          .frame(maxWidth: .infinity, alignment: .leading)
          .fixedSize(horizontal: false, vertical: true)
        actions
      }
      below
    }
    .padding(10)
    .padding(.leading, 3)
    .background(tone.soft(theme))
    .overlay(alignment: .leading) { Rectangle().fill(tone.color(theme)).frame(width: 3) }
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
    .accessibilityElement(children: .contain)
    .accessibilityLabel(title)
  }
}
