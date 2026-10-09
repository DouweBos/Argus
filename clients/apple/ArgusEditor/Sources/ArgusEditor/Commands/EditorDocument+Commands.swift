import AppKit
@preconcurrency import CodeEditTextView

extension EditorDocument {
  /// Runs `command` on the buffer: each edit is one undo group, and works on every caret.
  public func perform(_ command: EditorCommand) {
    actions?.commandPerformed(command)
    switch command {
    case .goToLine: isGoToLineVisible = true
    case .nextProblem: goToProblem(forward: true)
    case .previousProblem: goToProblem(forward: false)
    case .goToDefinition: goToDefinition()
    case .triggerCompletion: triggerCompletion()
    case .jumpToBracket: jumpToBracket()
    case .fold: folding.foldAtCaret()
    case .unfold: folding.unfoldAtCaret()
    case .foldAll: folding.foldAll()
    case .unfoldAll: folding.unfoldAll()
    default:
      guard let plan = plan(for: command, in: editContext()) else { return }
      run(plan)
    }
  }

  func editContext() -> EditContext {
    EditContext(
      text: storage, selections: engine.textView.selectionManager.textSelections.map(\.range),
      configuration: configuration, lines: lineIndex)
  }

  /// The edit `command` makes; nil when there's nothing to do.
  func plan(for command: EditorCommand, in context: EditContext) -> EditPlan? {
    let editing = isEditable
    switch command {
    case .toggleLineComment:
      guard editing, let tokens = CommentTokens.for(language) else { return nil }
      return CommentToggle.toggleLine(context, tokens: tokens)
    case .toggleBlockComment:
      guard editing, let tokens = CommentTokens.for(language) else { return nil }
      return CommentToggle.toggleBlock(context, tokens: tokens)
    case .moveLinesUp, .moveLinesDown:
      return editing ? LineEditing.moveLines(context, up: command == .moveLinesUp) : nil
    case .copyLinesUp, .copyLinesDown:
      return editing ? LineEditing.copyLines(context, up: command == .copyLinesUp) : nil
    case .deleteLines: return editing ? LineEditing.deleteLines(context) : nil
    case .insertLineBelow, .insertLineAbove:
      return editing ? LineEditing.insertLine(context, below: command == .insertLineBelow) : nil
    case .indentLines: return editing ? LineEditing.indent(context) : nil
    case .outdentLines: return editing ? LineEditing.outdent(context) : nil
    case .selectLine: return LineEditing.selectLine(context)
    case .addNextOccurrence: return SelectionCommands.addNextOccurrence(context)
    case .selectAllOccurrences: return SelectionCommands.selectAllOccurrences(context)
    case .addCursorAbove, .addCursorBelow: return SelectionCommands.addCursor(context, up: command == .addCursorAbove)
    case .jumpToBracket, .goToLine, .nextProblem, .previousProblem, .goToDefinition, .triggerCompletion,
      .fold, .unfold, .foldAll, .unfoldAll:
      return nil
    }
  }

  /// Applies `plan`'s edits as one undo group, then its selections.
  func run(_ plan: EditPlan) {
    replace(plan.edits.map { ($0.range, $0.text) }, selectAfter: false)
    let selectionManager: TextSelectionManager = engine.textView.selectionManager
    if plan.selections.count == 1, let only = plan.selections.first {
      selectionManager.setSelectedRange(only)
    } else {
      selectionManager.setSelectedRanges(plan.selections)
    }
    if let reveal = plan.reveal ?? plan.selections.first { engine.center(reveal) }
  }

  private func jumpToBracket() {
    guard let selection = engine.textView.selectionManager.textSelections.first?.range,
      let target = SelectionCommands.matchingBracket(in: storage, at: selection.location)
    else { return NSSound.beep() }
    run(EditPlan(selections: [NSRange(location: target, length: 0)]))
  }

  /// Puts the caret on the next diagnostic and shows its card.
  private func goToProblem(forward: Bool) {
    guard let diagnostic = SelectionCommands.diagnostic(in: diagnostics, from: caret, forward: forward) else {
      return NSSound.beep()
    }
    let offset = offset(of: diagnostic.range.start)
    run(EditPlan(selections: [NSRange(location: offset, length: 0)]))
    interaction.hover.present(at: offset)
  }

  /// Puts the caret at a "Go to Line…" target.
  public func go(to target: GoToLineTarget) {
    reveal(line: target.line, column: target.column, highlight: true)
    focus()
  }
}
