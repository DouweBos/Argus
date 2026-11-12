import ArgusCore
import SwiftUI

/// Summary and description over a slim strip of options, as the Mac's commit
/// composer: Amend / Sign off / Sign as chips, and who the commit is authored as.
/// Templates and identity profiles live on the Mac itself, so they stay there.
struct CommitComposer: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  let sessionId: String
  let allowsAmend: Bool
  let changeSummary: String
  @Binding var busy: String?
  /// Called with what to tell the user once the commit lands.
  let onCommitted: (String) async -> Void

  @State private var message = CommitMessage()
  /// What the fields held before amend filled them with the last commit's.
  @State private var draftBeforeAmend: CommitMessage?
  @State private var amend = false
  @State private var signOff = false
  @State private var sign = false
  @State private var identity: HostStore.CommitIdentity?
  @State private var draftError: String?

  private var canCommit: Bool { !message.isEmpty && busy == nil }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      fields
      if let draftError {
        Banner(text: draftError, tone: .danger)
      }
      ChipFlowLayout(spacing: 6, lineSpacing: 6) {
        Chip(label: busy == "draft" ? "Drafting…" : "Draft", icon: Icon.draft) { draft() }
          .disabled(busy != nil)
          .accessibilityHint("Claude writes a message for these changes")
        if allowsAmend {
          optionChip("Amend", on: amend) { setAmend(!amend) }
        }
        optionChip("Sign off", on: signOff) { signOff.toggle() }
          .accessibilityHint("Adds a Signed-off-by trailer")
        if identity?.can_sign == true {
          optionChip("Sign", on: sign) { sign.toggle() }
            .accessibilityHint("Signs the commit with the computer's key")
        }
        if let label = identity?.label {
          Chip(label: label, icon: Icon.person)
            .accessibilityLabel("Commits as \(label)")
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      // A phone can't fit the summary and the button on one line;
      // squeezed together the button wrapped a letter per line.
      ViewThatFits(in: .horizontal) {
        HStack(spacing: 12) {
          MutedText(changeSummary).fixedSize()
          Spacer(minLength: 0)
          commitButton(hugs: true)
        }
        VStack(alignment: .leading, spacing: 8) {
          MutedText(changeSummary)
          commitButton(hugs: false)
        }
      }
    }
    .task(id: sessionId) { identity = await host.commitIdentity(sessionId: sessionId) }
  }

  /// One field box, the summary over the description, like the Mac's.
  private var fields: some View {
    VStack(alignment: .leading, spacing: 0) {
      TextField("Summary", text: $message.summary, prompt: prompt("Summary"))
        .font(.scaled(size: 15, weight: .medium))
        .submitLabel(.next)
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
      Rectangle().fill(theme.border).frame(height: 1)
      TextField(
        "Description", text: $message.description, prompt: prompt("Description"), axis: .vertical
      )
      .font(.scaled(size: 15))
      .lineLimit(2...8)
      .padding(.horizontal, 10)
      .padding(.vertical, 9)
    }
    .foregroundStyle(theme.text)
    .background(theme.bgTertiary)
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
    .overlay(RoundedRectangle(cornerRadius: theme.radiusSmall).stroke(theme.border, lineWidth: 1))
  }

  private func prompt(_ text: String) -> Text {
    Text(text).foregroundStyle(theme.textMuted)
  }

  private func optionChip(_ label: String, on: Bool, toggle: @escaping () -> Void) -> some View {
    Chip(label: label, icon: on ? Icon.check : nil, tone: on ? .accent : nil, action: toggle)
      .accessibilityAddTraits(on ? .isSelected : [])
      .disabled(busy != nil)
  }

  private func commitButton(hugs: Bool) -> some View {
    Btn(
      label: busy == "commit" ? "Committing…" : amend ? "Amend" : "Commit all",
      small: true, icon: Icon.check, hugs: hugs
    ) { commit() }
    .fixedSize(horizontal: hugs, vertical: false)
    .disabled(!canCommit)
  }

  /// Amending starts from the last commit's message, as git's own editor
  /// would; turning it off brings back what was typed before.
  private func setAmend(_ on: Bool) {
    amend = on
    if on {
      draftBeforeAmend = message
      Task {
        guard let last = await host.branchLog(sessionId: sessionId, ref: "HEAD", count: 1)?.first,
          amend, message == draftBeforeAmend
        else { return }
        message = CommitMessage(parsing: last.body.isEmpty ? last.subject : "\(last.subject)\n\n\(last.body)")
      }
    } else if let draft = draftBeforeAmend {
      message = draft
      draftBeforeAmend = nil
    }
  }

  /// The phone commits every change, so Claude reads them all.
  private func draft() {
    busy = "draft"
    draftError = nil
    Task {
      defer { busy = nil }
      do {
        if let drafted = try await host.draftCommitMessage(sessionId: sessionId, allChanges: true) {
          message = drafted
        }
      } catch {
        draftError = HostStore.describe(error)
      }
    }
  }

  private func commit() {
    busy = "commit"
    let amending = amend
    Task {
      let output = await host.commit(
        sessionId: sessionId, message: message.text, amend: amending, signOff: signOff,
        sign: sign)
      busy = nil
      guard output != nil else { return }
      message = CommitMessage()
      draftBeforeAmend = nil
      amend = false
      await onCommitted(amending ? "Amended the last commit." : "Committed.")
    }
  }
}
