import AppKit
import SwiftUI

/// Quick open's query field. AppKit's field editor eats ↑/↓ before SwiftUI's `onKeyPress` sees
/// them, so the keys that move the list come in as its commands instead; focus never leaves the field.
struct QuickOpenField: NSViewRepresentable {
  @Binding var text: String
  let placeholder: String
  let fontSize: CGFloat
  let move: (QuickOpenModel.Move) -> Void
  let submit: () -> Void
  let cancel: () -> Void

  func makeNSView(context: Context) -> NSTextField {
    let field = NSTextField()
    field.isBordered = false
    field.drawsBackground = false
    field.focusRingType = .none
    field.usesSingleLineMode = true
    field.cell?.lineBreakMode = .byTruncatingTail
    field.delegate = context.coordinator
    field.setAccessibilityLabel("Quick open")
    DispatchQueue.main.async {
      field.window?.makeFirstResponder(field)
      field.currentEditor()?.selectedRange = NSRange(location: (field.stringValue as NSString).length, length: 0)
    }
    return field
  }

  func updateNSView(_ field: NSTextField, context: Context) {
    context.coordinator.parent = self
    field.placeholderString = placeholder
    if field.font?.pointSize != fontSize { field.font = .systemFont(ofSize: fontSize) }
    if field.stringValue != text {
      field.stringValue = text
      field.currentEditor()?.selectedRange = NSRange(location: (text as NSString).length, length: 0)
    }
  }

  func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

  final class Coordinator: NSObject, NSTextFieldDelegate {
    var parent: QuickOpenField

    init(parent: QuickOpenField) {
      self.parent = parent
    }

    func controlTextDidChange(_ notification: Notification) {
      guard let field = notification.object as? NSTextField else { return }
      parent.text = field.stringValue
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
      if let move = Self.move(for: selector) {
        parent.move(move)
      } else if selector == #selector(NSResponder.insertNewline(_:)) {
        parent.submit()
      } else if selector == #selector(NSResponder.cancelOperation(_:)) {
        parent.cancel()
      } else {
        return false
      }
      return true
    }

    /// ↑/↓ and ⌃P/⌃N (the same commands), Page Up/Down, Home/End.
    nonisolated static func move(for selector: Selector) -> QuickOpenModel.Move? {
      switch selector {
      case #selector(NSResponder.moveDown(_:)): .next
      case #selector(NSResponder.moveUp(_:)): .previous
      case #selector(NSResponder.pageDown(_:)), #selector(NSResponder.scrollPageDown(_:)): .pageDown
      case #selector(NSResponder.pageUp(_:)), #selector(NSResponder.scrollPageUp(_:)): .pageUp
      case #selector(NSResponder.scrollToBeginningOfDocument(_:)): .first
      case #selector(NSResponder.scrollToEndOfDocument(_:)): .last
      default: nil
      }
    }
  }
}
