import ArgusKit
import SwiftUI

/// A tool's input, as labelled values.
///
/// Braces and quotes carry nothing — which field and what is in it is the
/// whole story, so even a tool nobody wrote a view for reads as a list.
struct ToolInputFieldsView: View {
  @Environment(\.theme) private var theme

  let fields: [ToolInputField]

  /// Past this a value is cut off; the desktop is where you read a long one.
  private let valueLineLimit = 12

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      ForEach(fields) { field in
        if field.isLong {
          VStack(alignment: .leading, spacing: 2) {
            label(field.label)
            MonoText(text: field.value, size: 11, lineLimit: valueLineLimit)
          }
        } else {
          HStack(alignment: .firstTextBaseline, spacing: 6) {
            label(field.label)
            MonoText(text: field.value, size: 11, lineLimit: 1)
          }
        }
      }
    }
  }

  private func label(_ text: String) -> some View {
    Text(text)
      .font(.system(size: 10, weight: .bold))
      .foregroundStyle(theme.textMuted)
  }
}

/// An answered AskUserQuestion: what was asked, and what was picked.
struct AnsweredQuestionsView: View {
  @Environment(\.theme) private var theme

  let questions: [Questions.Question]
  /// The answer the agent received, which is the only record of the picks.
  let answer: String

  private var parsed: [Int: (picks: [String], note: String?)] {
    Questions.parseAnswer(answer, questions: questions)
  }

  var body: some View {
    let answers = parsed
    VStack(alignment: .leading, spacing: 10) {
      ForEach(Array(questions.enumerated()), id: \.offset) { index, question in
        VStack(alignment: .leading, spacing: 4) {
          Text(question.header ?? question.question)
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(theme.textMuted)
          answerRows(for: question, answered: answers[index])
        }
      }
    }
  }

  @ViewBuilder
  private func answerRows(
    for question: Questions.Question, answered: (picks: [String], note: String?)?
  ) -> some View {
    let picks = answered?.picks ?? []
    let note = answered?.note
    if picks.isEmpty && note == nil {
      MutedText("No answer")
    } else {
      ForEach(picks, id: \.self) { pick in
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Image(systemName: Icon.check)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(theme.success)
          VStack(alignment: .leading, spacing: 1) {
            Text(pick).font(.system(size: 13)).foregroundStyle(theme.text)
            if let description = question.options.first(where: { $0.label == pick })?
              .description
            {
              MutedText(description)
            }
          }
        }
      }
      if let note {
        MutedText(note)
      }
    }
  }
}
