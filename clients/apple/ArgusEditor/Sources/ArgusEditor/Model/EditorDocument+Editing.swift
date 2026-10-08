import AppKit
@preconcurrency import CodeEditTextView

extension EditorDocument: @preconcurrency TextViewDelegate {
  public func textView(_ textView: TextView, willReplaceContentsIn range: NSRange, with string: String) {
    pendingChange = lineIndex.editorRange(range)
  }

  public func textView(_ textView: TextView, didReplaceContentsIn range: NSRange, with string: String) {
    let newLength = (string as NSString).length
    lineIndex.apply(location: range.location, oldLength: range.length, newLength: newLength, text: storage)
    version += 1
    highlighter.didEdit(range: range, newText: string, fullText: storage)
    recomputeDirty()
    if !suppressIncrementalChanges, let old = pendingChange {
      onTextChange?(EditorTextChange(range: old, text: string, version: version))
    }
    pendingChange = nil
    interaction.textDidChange(range: range, replacement: string)
    find.textDidChange()
    onDecorationsChange?()
  }
}

extension EditorDocument {
  /// Applies `edits` (ranges in the current text) as one undo group. `moveCaret` puts the caret
  /// after the last edit; otherwise it stays where it was (a format, a rename elsewhere).
  public func apply(edits: [(EditorRange, String)], moveCaret: Bool = true) {
    replace(edits.map { (nsRange($0.0), $0.1) }, selectAfter: moveCaret)
  }

  func replace(_ edits: [(NSRange, String)], selectAfter: Bool) {
    guard !edits.isEmpty else { return }
    let textView = engine.textView
    let wasEditable = textView.isEditable
    textView.isEditable = true
    let selections = textView.selectionManager.textSelections.map(\.range)
    engine.undoManager?.beginUndoGrouping()
    for (range, text) in edits.sorted(by: { $0.0.location > $1.0.location }) {
      textView.replaceCharacters(in: range, with: text, skipUpdateSelection: true)
    }
    engine.undoManager?.endUndoGrouping()
    textView.isEditable = wasEditable
    if selectAfter, let last = edits.max(by: { $0.0.location < $1.0.location }) {
      // Caret after the last edit, shifted by everything before it.
      let delta = edits.filter { $0.0.location < last.0.location }.reduce(0) { $0 + ($1.1 as NSString).length - $1.0.length }
      let end = last.0.location + delta + (last.1 as NSString).length
      textView.selectionManager.setSelectedRange(NSRange(location: min(end, storage.length), length: 0))
    } else {
      // Each caret shifts by what changed before it.
      let length = storage.length
      textView.selectionManager.setSelectedRanges(
        selections.map { selection in
          let delta = edits.filter { NSMaxRange($0.0) <= selection.location }
            .reduce(0) { $0 + ($1.1 as NSString).length - $1.0.length }
          return NSRange(location: min(max(0, selection.location + delta), length), length: 0)
        })
    }
  }

  /// Takes an external change to the file: one undo group, caret and scroll kept on the same
  /// lines, changed lines flashed. Listeners see one full-document replace.
  public func reload(from newText: String, flashChanges: Bool) {
    let old = storage.copy() as! NSString
    let new = newText as NSString
    guard !old.isEqual(to: newText) else {
      markSaved()
      return
    }
    let newIndex = LineIndex(new)
    let plan = ReloadPlan(old: old, new: new, oldIndex: lineIndex, newIndex: newIndex)
    let oldEnd = lineIndex.position(of: old.length)
    let caretBefore = caret
    let anchor = engine.firstVisibleLine
    let mappedCaretLine = plan.mapLine(caretBefore.line)

    suppressIncrementalChanges = true
    let textView = engine.textView
    let wasEditable = textView.isEditable
    textView.isEditable = true
    engine.undoManager?.beginUndoGrouping()
    textView.replaceCharacters(in: plan.replaceRange, with: plan.replacement, skipUpdateSelection: true)
    engine.undoManager?.endUndoGrouping()
    textView.isEditable = wasEditable
    suppressIncrementalChanges = false

    savedText = new.copy() as! NSString
    recomputeDirty()
    onTextChange?(
      EditorTextChange(
        range: EditorRange(start: EditorPosition(line: 0, utf16Column: 0), end: oldEnd), text: newText,
        version: version, isFullReplace: true))

    let caretOffset = offset(of: EditorPosition(line: mappedCaretLine, utf16Column: caretBefore.utf16Column))
    textView.selectionManager.setSelectedRange(NSRange(location: caretOffset, length: 0))
    if let anchor {
      engine.scroll(toLine: plan.mapLine(anchor.line), offset: anchor.offset)
    }
    if flashChanges {
      for lines in plan.changedLines {
        engine.decorations.addWash(
          .init(lines: lines, color: engine.theme.flash, start: CACurrentMediaTime(), duration: 1.5))
      }
    }
  }

  /// Scrolls to a 1-based line, puts the caret there and briefly highlights it. Safe to call before the
  /// view exists: it's applied when the editor comes on screen.
  public func reveal(line: Int, column: Int? = nil, highlight: Bool = true) {
    pendingReveal = PendingReveal(line: line, column: column, highlight: highlight)
    applyPendingRevealIfAttached()
  }

  func applyPendingRevealIfAttached() {
    guard let reveal = pendingReveal, engine.textView.window != nil, engine.scrollView.frame.height > 0 else { return }
    pendingReveal = nil
    let line = min(max(0, reveal.line - 1), lineIndex.lineCount - 1)
    let column = max(0, (reveal.column ?? 1) - 1)
    let location = offset(of: EditorPosition(line: line, utf16Column: column))
    engine.textView.selectionManager.setSelectedRange(NSRange(location: location, length: 0))
    engine.center(NSRange(location: location, length: 0))
    if reveal.highlight {
      engine.decorations.addWash(
        .init(lines: line..<(line + 1), color: engine.theme.flash, start: CACurrentMediaTime(), duration: 1.2))
    }
  }

  // MARK: Find

  public func showFind(replace: Bool) {
    find.show(replace: replace)
  }

  public func findNext() {
    find.next()
  }

  public func findPrevious() {
    find.previous()
  }

  /// Hands the selection to the agent (⌥⌘L).
  public func sendSelectionToAgent() {
    guard let text = selectedText, !text.isEmpty else { return }
    actions?.sendSelectionToAgent(text: text, range: selection)
  }

  /// Go to definition at the caret (F12).
  public func goToDefinition() {
    interaction.goToDefinition(at: caret)
  }

  /// Opens the completion list at the caret (⌃Space).
  public func triggerCompletion() {
    interaction.completion.request(trigger: nil, explicit: true)
  }
}
