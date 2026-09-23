import SwiftUI
import UIKit

/// A growing text view that accepts pasted images.
///
/// SwiftUI's `TextField` silently drops an image paste, and screenshots are
/// most of what you send an agent from a phone — so the input is a real
/// `UITextView` with `paste(_:)` intercepted.
struct PastingTextView: UIViewRepresentable {
  @Binding var text: String
  @Binding var height: CGFloat
  var placeholder: String
  var minHeight: CGFloat = 36
  var maxHeight: CGFloat = 120
  var onPasteImages: ([UIImage]) -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(text: $text, height: $height, minHeight: minHeight, maxHeight: maxHeight)
  }

  func makeUIView(context: Context) -> ImagePastingTextView {
    let view = ImagePastingTextView()
    view.delegate = context.coordinator
    view.onPasteImages = onPasteImages
    view.font = .systemFont(ofSize: 15)
    view.backgroundColor = .clear
    view.textContainerInset = UIEdgeInsets(top: 8, left: 6, bottom: 8, right: 6)
    view.textContainer.lineFragmentPadding = 0
    view.autocapitalizationType = .none
    view.autocorrectionType = .no
    view.isScrollEnabled = false
    // The field lives in a stack that already scrolls; let it grow instead.
    view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    return view
  }

  func updateUIView(_ view: ImagePastingTextView, context: Context) {
    // Setting `text` programmatically (a send clearing the field) does not
    // fire the delegate, so the height has to be recomputed here too — and
    // TextKit lays out lazily, so without forcing it `sizeThatFits` still
    // reports the height of the message that was just sent. `layoutIfNeeded`
    // is not enough: it lays out the view, not the text.
    if view.text != text {
      view.text = text
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

  final class Coordinator: NSObject, UITextViewDelegate {
    private let text: Binding<String>
    private let height: Binding<CGFloat>
    private let minHeight: CGFloat
    private let maxHeight: CGFloat

    init(text: Binding<String>, height: Binding<CGFloat>, minHeight: CGFloat, maxHeight: CGFloat) {
      self.text = text
      self.height = height
      self.minHeight = minHeight
      self.maxHeight = maxHeight
    }

    func textViewDidChange(_ textView: UITextView) {
      text.wrappedValue = textView.text
      recalculateHeight(textView)
    }

    func recalculateHeight(_ textView: UITextView) {
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
    private func apply(_ newHeight: CGFloat) {
      guard abs(newHeight - height.wrappedValue) > 0.5 else { return }
      Task { @MainActor in height.wrappedValue = newHeight }
    }
  }
}

final class ImagePastingTextView: UITextView {
  var onPasteImages: (([UIImage]) -> Void)?

  /// Offer Paste when the pasteboard holds images, which UIKit would
  /// otherwise hide for a plain-text view.
  override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
    if action == #selector(paste(_:)), UIPasteboard.general.hasImages {
      return true
    }
    return super.canPerformAction(action, withSender: sender)
  }

  override func paste(_ sender: Any?) {
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
