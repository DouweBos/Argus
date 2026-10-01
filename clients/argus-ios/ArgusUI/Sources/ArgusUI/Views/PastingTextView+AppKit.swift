#if os(macOS)
  import AppKit
  import SwiftUI

  /// The macOS counterpart of the phone's composer: an `NSTextView` that grows
  /// with its text and hands pasted images over instead of dropping them.
  struct PastingTextView: NSViewRepresentable {
    public static let collapsedHeight: CGFloat = 36

    @Binding public var text: String
    @Binding public var height: CGFloat
    public var placeholder: String
    public var minHeight: CGFloat = Self.collapsedHeight
    public var maxHeight: CGFloat = 120
    public var onPasteImages: ([PlatformImage]) -> Void

    public func makeCoordinator() -> Coordinator {
      Coordinator(text: $text, height: $height, minHeight: minHeight, maxHeight: maxHeight)
    }

    public func makeNSView(context: Context) -> NSScrollView {
      let scroll = NSScrollView()
      scroll.drawsBackground = false
      scroll.hasVerticalScroller = true
      scroll.autohidesScrollers = true
      scroll.borderType = .noBorder

      let view = ImagePastingTextView()
      view.delegate = context.coordinator
      view.onPasteImages = onPasteImages
      view.font = .systemFont(ofSize: 15)
      view.drawsBackground = false
      view.isRichText = false
      view.textContainerInset = NSSize(width: 6, height: 8)
      view.textContainer?.lineFragmentPadding = 0
      view.isAutomaticQuoteSubstitutionEnabled = false
      view.isAutomaticDashSubstitutionEnabled = false
      view.isVerticallyResizable = true
      view.isHorizontallyResizable = false
      view.autoresizingMask = [.width]
      view.textContainer?.widthTracksTextView = true
      scroll.documentView = view
      return scroll
    }

    public func updateNSView(_ scroll: NSScrollView, context: Context) {
      guard let view = scroll.documentView as? ImagePastingTextView else { return }
      if view.string != text { view.string = text }
      view.onPasteImages = onPasteImages
      view.textColor = NSColor(context.environment.theme.text)
      context.coordinator.recalculateHeight(view)
    }

    @MainActor
    public final class Coordinator: NSObject, NSTextViewDelegate {
      private let text: Binding<String>
      private let height: Binding<CGFloat>
      private let minHeight: CGFloat
      private let maxHeight: CGFloat
      private var pendingHeight: Task<Void, Never>?

      public init(text: Binding<String>, height: Binding<CGFloat>, minHeight: CGFloat, maxHeight: CGFloat) {
        self.text = text
        self.height = height
        self.minHeight = minHeight
        self.maxHeight = maxHeight
      }

      public func textDidChange(_ notification: Notification) {
        guard let view = notification.object as? NSTextView else { return }
        text.wrappedValue = view.string
        recalculateHeight(view)
      }

      public func recalculateHeight(_ view: NSTextView) {
        guard !view.string.isEmpty,
          let container = view.textContainer, let layout = view.layoutManager
        else {
          apply(minHeight)
          return
        }
        layout.ensureLayout(for: container)
        let used = layout.usedRect(for: container).height + view.textContainerInset.height * 2
        apply(min(max(used, minHeight), maxHeight))
      }

      /// Lands on the next turn so `updateNSView` never mutates state mid-update.
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

  final class ImagePastingTextView: NSTextView {
    public var onPasteImages: (([PlatformImage]) -> Void)?

    public override func paste(_ sender: Any?) {
      let pasteboard = NSPasteboard.general
      if let images = pasteboard.readObjects(forClasses: [NSImage.self]) as? [NSImage],
        !images.isEmpty,
        pasteboard.string(forType: .string) == nil
      {
        onPasteImages?(images)
        return
      }
      pasteAsPlainText(sender)
    }
  }
#endif
