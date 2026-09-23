import ArgusKit
import SwiftUI

/// Approve a plan, or send it back with feedback.
struct PlanApprovalView: View {
  @Environment(\.theme) private var theme
  let plan: String
  let onApprove: () -> Void
  let onKeepPlanning: () -> Void
  let onFeedback: (String) -> Void
  /// Absent when the plan's repo can't be resolved — there is nowhere to put
  /// the new session.
  var onApproveInNewSession: (() -> Void)?

  @State private var feedback = ""
  @State private var showingFullScreen = false

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      ScrollView {
        MarkdownView(text: plan, baseSize: 14)
      }
      .frame(maxHeight: 280)
      .padding(10)
      .background(theme.bgTertiary)
      .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
      .overlay(alignment: .topTrailing) {
        PlanExpandButton { showingFullScreen = true }
      }

      PlanActions(
        feedback: $feedback,
        onApprove: onApprove,
        onKeepPlanning: onKeepPlanning,
        onFeedback: onFeedback,
        onApproveInNewSession: onApproveInNewSession)
    }
    .fullScreenCover(isPresented: $showingFullScreen) {
      PlanFullScreenView(
        plan: plan,
        actions: .init(
          feedback: $feedback,
          onApprove: onApprove,
          onKeepPlanning: onKeepPlanning,
          onFeedback: onFeedback,
          onApproveInNewSession: onApproveInNewSession))
    }
  }
}

/// Opens the plan full screen. Sits over the corner of a clamped plan box, so
/// it carries its own backing to stay legible on top of text.
struct PlanExpandButton: View {
  @Environment(\.theme) private var theme
  let action: () -> Void

  var body: some View {
    IconBtn(systemName: Icon.expand, label: "View full plan", size: 14, action: action)
      .background(theme.bgSecondary.opacity(0.9), in: Circle())
      .overlay(Circle().stroke(theme.borderSubtle, lineWidth: 1))
      .padding(6)
  }
}

/// The feedback field and the decision buttons, shared by the inline card and
/// the full-screen plan so both edit the same draft.
private struct PlanActions: View {
  @Binding var feedback: String
  let onApprove: () -> Void
  let onKeepPlanning: () -> Void
  let onFeedback: (String) -> Void
  var onApproveInNewSession: (() -> Void)?

  @State private var confirmingHandoff = false

  private var trimmed: String {
    feedback.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      ThemedTextField(placeholder: "Feedback (optional)", text: $feedback, multiline: true)

      HStack(spacing: 8) {
        Btn(label: "Approve", small: true, action: onApprove)
        // The second button changes meaning once there is something to send.
        if trimmed.isEmpty {
          Btn(label: "Keep planning", tone: .ghost, small: true, action: onKeepPlanning)
        } else {
          Btn(label: "Send feedback", tone: .secondary, small: true) { onFeedback(trimmed) }
        }
      }

      // Its own row: three buttons don't fit across a phone.
      if onApproveInNewSession != nil {
        Btn(label: "Approve in new session", tone: .secondary, small: true) {
          confirmingHandoff = true
        }
      }
    }
    .alert("Implement in a new session?", isPresented: $confirmingHandoff) {
      Button("Cancel", role: .cancel) {}
      Button("Create") { onApproveInNewSession?() }
    } message: {
      Text("Argus starts a new session on this plan. This one stays in plan mode.")
    }
  }
}

/// The plan at full size. A plan is many screens long on a phone, so reading
/// it in the transcript's clamped box means dragging a keyhole around.
struct PlanFullScreenView: View {
  /// Absent for a plan that has already been answered — history is read-only.
  struct Actions {
    var feedback: Binding<String>
    var onApprove: () -> Void
    var onKeepPlanning: () -> Void
    var onFeedback: (String) -> Void
    var onApproveInNewSession: (() -> Void)?
  }

  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss
  let plan: String
  var actions: Actions?

  var body: some View {
    NavigationStack {
      ScrollView {
        MarkdownView(text: plan, baseSize: 15)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(16)
      }
      .background(theme.bg)
      .navigationTitle("Plan")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          IconBtn(systemName: Icon.close, label: "Close") { dismiss() }
        }
      }
      .safeAreaInset(edge: .bottom) {
        if let actions {
          // Answering closes the cover first: the card underneath resolves as
          // soon as the response goes out, and it should be the thing on screen.
          PlanActions(
            feedback: actions.feedback,
            onApprove: { dismiss(); actions.onApprove() },
            onKeepPlanning: { dismiss(); actions.onKeepPlanning() },
            onFeedback: { feedback in
              dismiss()
              actions.onFeedback(feedback)
            },
            onApproveInNewSession: actions.onApproveInNewSession.map { handOff in
              {
                dismiss()
                handOff()
              }
            })
          .padding(16)
          .background(theme.bgSecondary)
          .overlay(alignment: .top) {
            Rectangle().fill(theme.border).frame(height: 1)
          }
        }
      }
    }
  }
}

/// The inline AskUserQuestion form.
struct QuestionFormView: View {
  @Environment(\.theme) private var theme
  let questions: [Questions.Question]
  let onSubmit: (String) -> Void
  let onCancel: () -> Void

  @State private var picks: [Int: [String]] = [:]
  @State private var custom: [Int: String] = [:]

  private var allAnswered: Bool {
    questions.indices.allSatisfy { index in
      let chosen = picks[index] ?? []
      guard !chosen.isEmpty else { return false }
      // A custom pick with nothing typed into it isn't an answer.
      if chosen.contains(Questions.customKey) {
        let note = (custom[index] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return !note.isEmpty || chosen.count > 1
      }
      return true
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      ForEach(Array(questions.enumerated()), id: \.offset) { index, question in
        VStack(alignment: .leading, spacing: 6) {
          Text(question.header ?? "Question \(index + 1)")
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(theme.textMuted)
          BodyText(question.question)

          ForEach(question.options) { option in
            optionRow(index: index, question: question, label: option.label,
                      description: option.description)
          }
          optionRow(
            index: index, question: question, label: Questions.customKey,
            description: nil, isCustom: true)

          if (picks[index] ?? []).contains(Questions.customKey) {
            ThemedTextField(
              placeholder: "Your answer",
              text: Binding(
                get: { custom[index] ?? "" },
                set: { custom[index] = $0 }))
          }
        }
      }

      HStack(spacing: 8) {
        Btn(label: "Submit", small: true) {
          onSubmit(
            Questions.formatAnswer(questions: questions, picks: picks, custom: custom))
        }
        .disabled(!allAnswered)
        Btn(label: "Cancel", tone: .ghost, small: true, action: onCancel)
      }
    }
  }

  private func optionRow(
    index: Int, question: Questions.Question, label: String, description: String?,
    isCustom: Bool = false
  ) -> some View {
    let chosen = picks[index] ?? []
    let selected = chosen.contains(label)

    return Button {
      toggle(index: index, question: question, label: label)
    } label: {
      HStack(alignment: .top, spacing: 8) {
        Image(
          systemName: question.multiSelect
            ? (selected ? "checkmark.square.fill" : "square")
            : (selected ? "largecircle.fill.circle" : "circle")
        )
        .font(.system(size: 15))
        .foregroundStyle(selected ? theme.accent : theme.textMuted)

        VStack(alignment: .leading, spacing: 2) {
          Text(isCustom ? "Type your own answer" : label)
            .font(.system(size: 14))
            .foregroundStyle(theme.text)
          if let description {
            Text(description)
              .font(.system(size: 12))
              .foregroundStyle(theme.textMuted)
          }
        }
        Spacer(minLength: 0)
      }
      .padding(9)
      .background(selected ? theme.accentSoft : theme.bgTertiary)
      .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
      .overlay(
        RoundedRectangle(cornerRadius: theme.radiusSmall)
          .stroke(selected ? theme.accentBorder : .clear, lineWidth: 1))
    }
    .buttonStyle(.plain)
  }

  private func toggle(index: Int, question: Questions.Question, label: String) {
    var chosen = picks[index] ?? []
    if question.multiSelect {
      if let position = chosen.firstIndex(of: label) {
        chosen.remove(at: position)
      } else {
        chosen.append(label)
      }
    } else {
      // Re-tapping the current choice clears it.
      chosen = chosen == [label] ? [] : [label]
    }
    picks[index] = chosen
  }
}

/// Allow / Deny for an ordinary tool prompt.
struct PermissionButtons: View {
  let onAllow: () -> Void
  let onDeny: () -> Void

  var body: some View {
    HStack(spacing: 8) {
      Btn(label: "Allow", small: true, action: onAllow)
      Btn(label: "Deny", tone: .danger, small: true, action: onDeny)
    }
  }
}

struct TaskListView: View {
  @Environment(\.theme) private var theme
  let title: String
  let items: [(text: String, status: RemoteTaskStatus, owner: String?)]

  var body: some View {
    Card {
      HStack {
        Text("\(title) · \(items.count { $0.status == .completed }) done")
          .font(.system(size: 11, weight: .bold))
          .foregroundStyle(theme.textMuted)
        Spacer()
      }
      ForEach(Array(items.enumerated()), id: \.offset) { _, item in
        HStack(alignment: .top, spacing: 8) {
          mark(item.status)
          Text(item.text)
            .font(.system(size: 14))
            .foregroundStyle(item.status == .completed ? theme.textMuted : theme.text)
            .strikethrough(item.status == .completed)
          Spacer(minLength: 0)
          if let owner = item.owner, !owner.isEmpty {
            Badge(label: owner)
          }
        }
      }
    }
  }

  @ViewBuilder
  private func mark(_ status: RemoteTaskStatus) -> some View {
    switch status {
    case .completed:
      Image(systemName: Icon.check)
        .font(.system(size: 12, weight: .bold))
        .foregroundStyle(theme.success)
        .frame(width: 14, height: 18)
    case .inProgress:
      StatusDot(tone: .accent, pulse: true).frame(width: 14, height: 18)
    case .pending:
      StatusDot(tone: .muted).frame(width: 14, height: 18)
    }
  }
}
