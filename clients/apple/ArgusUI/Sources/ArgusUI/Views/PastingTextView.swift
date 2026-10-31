#if canImport(UIKit)
  import SwiftUI
  import UIKit

  /// A growing text view that accepts pasted images.
  ///
  /// SwiftUI's `TextField` silently drops an image paste, and screenshots are
  /// most of what you send an agent from a phone — so the input is a real
  /// `UITextView` with `paste(_:)` intercepted.
  struct PastingTextView: UIViewRepresentable {
    /// One empty line. The composer starts here and returns here on send.
    public static let collapsedHeight: CGFloat = 36

    @Binding public var text: String
    /// UTF-16 offset of the insertion point, for the caret-aware `@` menu.
    @Binding public var caret: Int
    @Binding public var height: CGFloat
    let controller: PastingTextController
    public var minHeight: CGFloat = Self.collapsedHeight
    public var maxHeight: CGFloat = 120
    public var onPasteImages: ([PlatformImage]) -> Void

    public func makeCoordinator() -> Coordinator {
      Coordinator(text: $text, caret: $caret, height: $height, minHeight: minHeight, maxHeight: maxHeight)
    }

    public func makeUIView(context: Context) -> ImagePastingTextView {
      let view = ImagePastingTextView()
      view.delegate = context.coordinator
      view.onPasteImages = onPasteImages
      view.font = .systemFont(ofSize: 15)
      view.backgroundColor = .clear
      view.textContainerInset = UIEdgeInsets(top: 8, left: 6, bottom: 8, right: 6)
      view.textContainer.lineFragmentPadding = 0
      // Prose, not code: this is where you talk to the agent, so it gets the
      // ordinary keyboard behaviour — QuickType, autocorrect, capitals. Smart
      // punctuation stays off; it mangles the quotes and dashes in a pasted
      // command or path.
      view.autocapitalizationType = .sentences
      view.autocorrectionType = .yes
      view.spellCheckingType = .yes
      view.smartQuotesType = .no
      view.smartDashesType = .no
      view.isScrollEnabled = false
      // The field lives in a stack that already scrolls; let it grow instead.
      view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
      view.text = text
      controller.textView = view
      return view
    }

    public func updateUIView(_ view: ImagePastingTextView, context: Context) {
      // Setting `text` programmatically (a send clearing the field) does not
      // fire the delegate, so the height has to be recomputed here too — and
      // TextKit lays out lazily, so without forcing it `sizeThatFits` still
      // reports the height of the message that was just sent. `layoutIfNeeded`
      // is not enough: it lays out the view, not the text.
      context.coordinator.isUpdating = true
      defer { context.coordinator.isUpdating = false }
      if view.text != text {
        view.text = text
        // A restored draft puts the caret at the end; the menus read it from there.
        let location = view.selectedRange.location
        Task { @MainActor in if caret != location { caret = location } }
        if let layout = view.textLayoutManager {
          layout.ensureLayout(for: layout.documentRange)
        } else {
          // TextKit 1 fallback. Only reached when the view already downgraded —
          // touching `layoutManager` on a TextKit 2 view is what downgrades it.
          view.layoutManager.ensureLayout(for: view.textContainer)
        }
      }
      view.onPasteImages = onPasteImages
      view.textColor = UIColor(context.environment.theme.text)
      context.coordinator.recalculateHeight(view)
    }

    public final class Coordinator: NSObject, UITextViewDelegate {
      private let text: Binding<String>
      private let caret: Binding<Int>
      private let height: Binding<CGFloat>
      private let minHeight: CGFloat
      private let maxHeight: CGFloat
      private var pendingHeight: Task<Void, Never>?
      /// Set while `updateUIView` writes the text, whose selection change mustn't write state back mid-update.
      var isUpdating = false

      public init(
        text: Binding<String>, caret: Binding<Int>, height: Binding<CGFloat>, minHeight: CGFloat, maxHeight: CGFloat
      ) {
        self.text = text
        self.caret = caret
        self.height = height
        self.minHeight = minHeight
        self.maxHeight = maxHeight
      }

      public func textViewDidChange(_ textView: UITextView) {
        text.wrappedValue = textView.text
        caret.wrappedValue = textView.selectedRange.location
        recalculateHeight(textView)
      }

      public func textViewDidChangeSelection(_ textView: UITextView) {
        guard !isUpdating else { return }
        let location = textView.selectedRange.location
        if caret.wrappedValue != location { caret.wrappedValue = location }
      }

      public func recalculateHeight(_ textView: UITextView) {
        let width = textView.bounds.width
        guard width > 0 else { return }

        // An empty field is one line — say so outright rather than trusting a
        // measurement of text that is no longer there.
        guard !textView.text.isEmpty else {
          textView.isScrollEnabled = false
          apply(minHeight)

          return
        }

        // A scrollable text view reports its *bounds* from `sizeThatFits`, not
        // its content — so once the field had grown past the cap it would never
        // measure small again. Always measure unscrollable, then decide.
        textView.isScrollEnabled = false
        let fitting = textView.sizeThatFits(
          CGSize(width: width, height: .greatestFiniteMagnitude))
        // Past the cap the field stops growing and scrolls internally instead.
        textView.isScrollEnabled = fitting.height > maxHeight

        apply(min(max(fitting.height, minHeight), maxHeight))
      }

      /// Writing straight from `updateUIView` would mutate state mid-update, so
      /// the new height lands on the next turn of the loop.
      ///
      /// Cancelling first — before the no-op guard — is what keeps a send from
      /// springing back: the measurement from the last keystroke is still in
      /// flight when the field is cleared, and landing afterwards it would
      /// restore the height of a message that is already gone.
      private func apply(_ newHeight: CGFloat) {
        pendingHeight?.cancel()
        guard abs(newHeight - height.wrappedValue) > 0.5 else { return }
        pendingHeight = Task { @MainActor in
          guard !Task.isCancelled else { return }
          height.wrappedValue = newHeight
        }
      }
    }
  }

  /// The phone composer's `ComposerEditor`, over its `UITextView`.
  @MainActor
  final class PastingTextController: ComposerEditor {
    fileprivate weak var textView: ImagePastingTextView?

    var caret: Int { textView?.selectedRange.location ?? 0 }

    func replace(with text: String, caret: Int?) {
      guard let view = textView else { return }
      let length = (text as NSString).length
      if let all = view.textRange(from: view.beginningOfDocument, to: view.endOfDocument) {
        // Through `UITextInput`, so the edit is one undo step.
        view.replace(all, withText: text)
      } else {
        view.text = text
      }
      view.selectedRange = NSRange(location: min(caret ?? length, length), length: 0)
      view.delegate?.textViewDidChange?(view)
    }

    func reset() {
      guard let view = textView else { return }
      view.text = ""
      view.undoManager?.removeAllActions()
      view.delegate?.textViewDidChange?(view)
    }

    func focus() {
      textView?.becomeFirstResponder()
    }
  }

  final class ImagePastingTextView: UITextView {
    public var onPasteImages: (([PlatformImage]) -> Void)?

    /// Offer Paste when the pasteboard holds images, which UIKit would
    /// otherwise hide for a plain-text view.
    public override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
      if action == #selector(paste(_:)), UIPasteboard.general.hasImages {
        return true
      }
      return super.canPerformAction(action, withSender: sender)
    }

    public override func paste(_ sender: Any?) {
      let pasteboard = UIPasteboard.general
      if pasteboard.hasImages, let images = pasteboard.images, !images.isEmpty {
        onPasteImages?(images)
        // A pasteboard carrying both is rare; the images are the payload the
        // user meant, and pasting the accompanying text too reads as a bug.
        return
      }
      super.paste(sender)
    }
  }
#endif
