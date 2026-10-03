import AppKit
import SwiftUI

/// A monospaced plain-text `NSTextView`: the merged-result editor, or a
/// read-only side. AppKit keeps a 50k-line file responsive where SwiftUI's
/// `TextEditor` doesn't.
struct ConflictTextView: NSViewRepresentable {
  @Binding var text: String
  var isEditable = true

  func makeNSView(context: Context) -> NSScrollView {
    let scroll = NSTextView.scrollableTextView()
    guard let textView = scroll.documentView as? NSTextView else { return scroll }
    textView.isRichText = false
    textView.allowsUndo = true
    textView.isEditable = isEditable
    textView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
    textView.textContainerInset = NSSize(width: 4, height: 6)
    textView.isAutomaticQuoteSubstitutionEnabled = false
    textView.isAutomaticDashSubstitutionEnabled = false
    textView.isAutomaticTextReplacementEnabled = false
    textView.isAutomaticSpellingCorrectionEnabled = false
    textView.isContinuousSpellCheckingEnabled = false
    textView.isGrammarCheckingEnabled = false
    textView.drawsBackground = false
    textView.delegate = context.coordinator
    textView.string = text
    scroll.drawsBackground = false
    return scroll
  }

  func updateNSView(_ scroll: NSScrollView, context: Context) {
    context.coordinator.text = $text
    guard let textView = scroll.documentView as? NSTextView else { return }
    textView.isEditable = isEditable
    if textView.string != text { textView.string = text }
  }

  func makeCoordinator() -> Coordinator { Coordinator(text: $text) }

  final class Coordinator: NSObject, NSTextViewDelegate {
    var text: Binding<String>
    init(text: Binding<String>) { self.text = text }

    func textDidChange(_ notification: Notification) {
      guard let textView = notification.object as? NSTextView else { return }
      text.wrappedValue = textView.string
    }
  }
}
