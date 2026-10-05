#if os(macOS)
  import AppKit
  import SwiftUI
  import UniformTypeIdentifiers

  /// Imperative handle on the composer's text view, for the edits SwiftUI
  /// can't express: undoable replacements, caret placement and focus.
  @MainActor
  final class ComposerController {
    private weak var textView: ComposerTextView?
    fileprivate var wantsFocus = false

    func attach(_ view: ComposerTextView) {
      textView = view
      view.controller = self
    }

    /// Replace the whole text as one undoable edit, caret at `caret` (UTF-16).
    func replace(with text: String, caret: Int? = nil) {
      guard let view = textView else { return }
      let range = NSRange(location: 0, length: (view.string as NSString).length)
      guard view.shouldChangeText(in: range, replacementString: text) else { return }
      view.replaceCharacters(in: range, with: text)
      let location = min(caret ?? (text as NSString).length, (text as NSString).length)
      // Before `didChangeText`, so the change reports the new caret.
      view.setSelectedRange(NSRange(location: location, length: 0))
      view.didChangeText()
    }

    /// Start over — after a send, ⌘Z shouldn't resurrect the message.
    func reset() {
      guard let view = textView else { return }
      view.string = ""
      view.undoManager?.removeAllActions()
      view.didChangeText()
    }

    func focus() {
      guard let view = textView, let window = view.window else {
        wantsFocus = true
        return
      }
      window.makeFirstResponder(view)
    }

    var caret: Int { textView?.selectedRange().location ?? 0 }
  }

  /// What arrived by paste or drop, for the parent to attach or mention.
  enum ComposerDrop {
    case images([PendingImage], pasted: Bool)
    case files([URL])
  }

  /// The macOS composer: an `NSTextView` that grows with its text, draws its
  /// own placeholder and argument hint, and routes keys, pastes and drops.
  struct ComposerField: NSViewRepresentable {
    static let minHeight: CGFloat = 38
    static let maxHeight: CGFloat = 160

    @Binding var text: String
    @Binding var caret: Int
    @Binding var height: CGFloat
    @Binding var isDropTarget: Bool
    let controller: ComposerController
    var placeholder: String
    var argumentHint: String?
    var isEnabled = true
    var onKey: (ComposerKey) -> Bool
    var onDrop: (ComposerDrop) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
      let scroll = NSScrollView()
      scroll.drawsBackground = false
      scroll.hasVerticalScroller = true
      scroll.autohidesScrollers = true
      scroll.borderType = .noBorder

      let view = ComposerTextView()
      view.delegate = context.coordinator
      view.font = .systemFont(ofSize: 13)
      view.drawsBackground = false
      view.isRichText = false
      view.importsGraphics = false
      view.allowsUndo = true
      view.textContainerInset = NSSize(width: 6, height: 10)
      view.textContainer?.lineFragmentPadding = 0
      view.isAutomaticQuoteSubstitutionEnabled = false
      view.isAutomaticDashSubstitutionEnabled = false
      view.isAutomaticTextReplacementEnabled = false
      view.isVerticallyResizable = true
      view.isHorizontallyResizable = false
      view.autoresizingMask = [.width]
      view.textContainer?.widthTracksTextView = true
      view.registerForDraggedTypes([.fileURL, .png, .tiff])
      view.string = text
      controller.attach(view)
      scroll.documentView = view
      return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
      guard let view = scroll.documentView as? ComposerTextView else { return }
      context.coordinator.parent = self
      context.coordinator.isUpdating = true
      defer { context.coordinator.isUpdating = false }
      if view.string != text {
        view.string = text
        // A restored draft puts the caret at the end; menus read it from there.
        let caret = view.selectedRange().location
        Task { @MainActor in if self.caret != caret { self.caret = caret } }
      }
      view.placeholder = placeholder
      let size = TextScale.shared(13)
      if view.font?.pointSize != size { view.font = .systemFont(ofSize: size) }
      view.isEditable = isEnabled
      view.argumentHint = argumentHint
      view.onKey = onKey
      view.onDrop = onDrop
      view.onDragHighlight = { isDropTarget = $0 }
      let theme = context.environment.theme
      view.textColor = NSColor(theme.text)
      view.insertionPointColor = NSColor(theme.text)
      view.mutedColor = NSColor(theme.textMuted)
      view.needsDisplay = true
      context.coordinator.recalculateHeight(view)
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
      var parent: ComposerField
      var isUpdating = false
      private var pendingHeight: Task<Void, Never>?
      /// The composer's own history, so a send can clear it without touching
      /// the window's.
      private let undo = UndoManager()

      init(_ parent: ComposerField) { self.parent = parent }

      func undoManager(for view: NSTextView) -> UndoManager? { undo }

      func textDidChange(_ notification: Notification) {
        guard let view = notification.object as? NSTextView else { return }
        parent.text = view.string
        parent.caret = view.selectedRange().location
        recalculateHeight(view)
      }

      func textViewDidChangeSelection(_ notification: Notification) {
        guard !isUpdating, let view = notification.object as? NSTextView else { return }
        let location = view.selectedRange().location
        if parent.caret != location { parent.caret = location }
      }

      func recalculateHeight(_ view: NSTextView) {
        guard !view.string.isEmpty, let container = view.textContainer,
          let layout = view.layoutManager
        else {
          apply(ComposerField.minHeight)
          return
        }
        layout.ensureLayout(for: container)
        let used = layout.usedRect(for: container).height + view.textContainerInset.height * 2
        apply(min(max(used.rounded(.up), ComposerField.minHeight), ComposerField.maxHeight))
      }

      /// Lands on the next turn so `updateNSView` never mutates state mid-update.
      private func apply(_ newHeight: CGFloat) {
        pendingHeight?.cancel()
        guard abs(newHeight - parent.height) > 0.5 else { return }
        pendingHeight = Task { @MainActor in
          guard !Task.isCancelled else { return }
          self.parent.height = newHeight
        }
      }
    }
  }

  final class ComposerTextView: NSTextView {
    weak var controller: ComposerController?
    var placeholder = ""
    var argumentHint: String?
    var mutedColor = NSColor.placeholderTextColor
    var onKey: ((ComposerKey) -> Bool)?
    var onDrop: ((ComposerDrop) -> Void)?
    var onDragHighlight: ((Bool) -> Void)?

    override func viewDidMoveToWindow() {
      super.viewDidMoveToWindow()
      guard let controller, controller.wantsFocus, let window else { return }
      controller.wantsFocus = false
      window.makeFirstResponder(self)
    }

    // MARK: Keys

    override func keyDown(with event: NSEvent) {
      if !hasMarkedText(), let key = composerKey(event), onKey?(key) == true { return }
      super.keyDown(with: event)
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
      if window?.firstResponder === self, let key = composerKey(event), key == .commandPeriod,
        onKey?(key) == true
      {
        return true
      }
      return super.performKeyEquivalent(with: event)
    }

    private func composerKey(_ event: NSEvent) -> ComposerKey? {
      let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
      let shift = flags.contains(.shift)
      if flags.contains(.command), event.charactersIgnoringModifiers == "." {
        return .commandPeriod
      }
      switch event.keyCode {
      case 36, 76: return .returnKey(shift: shift)
      case 48: return .tab(shift: shift)
      case 126 where flags.isDisjoint(with: [.command, .option, .shift]): return .up
      case 125 where flags.isDisjoint(with: [.command, .option, .shift]): return .down
      case 53: return .escape
      default: return nil
      }
    }

    // MARK: Paste and drop

    override func paste(_ sender: Any?) {
      if let drop = Self.drop(from: .general, pasted: true) {
        switch drop {
        case .images:
          onDrop?(drop)
          return
        // Finder copies carry the file's icon as an image; never attach that.
        case .files: break
        }
      }
      pasteAsPlainText(sender)
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
      guard Self.drop(from: sender.draggingPasteboard, pasted: false) != nil else {
        return super.draggingEntered(sender)
      }
      onDragHighlight?(true)
      return .copy
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
      Self.drop(from: sender.draggingPasteboard, pasted: false) != nil
        ? .copy : super.draggingUpdated(sender)
    }

    override func draggingExited(_ sender: NSDraggingInfo?) {
      onDragHighlight?(false)
      super.draggingExited(sender)
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
      onDragHighlight?(false)
      guard let drop = Self.drop(from: sender.draggingPasteboard, pasted: false) else {
        return super.performDragOperation(sender)
      }
      window?.makeFirstResponder(self)
      onDrop?(drop)
      return true
    }

    /// Files win over image data: a file's pasteboard entry also carries its
    /// icon. Image files attach; any other file becomes a mention.
    static func drop(from pasteboard: NSPasteboard, pasted: Bool) -> ComposerDrop? {
      let urls =
        (pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true])
          as? [URL]) ?? []
      if !urls.isEmpty {
        let images = urls.filter(ImageAttachments.isImage).compactMap(
          ImageAttachments.pending(fromFile:))
        let others = urls.filter { !ImageAttachments.isImage($0) }
        if !images.isEmpty, others.isEmpty || pasted { return .images(images, pasted: pasted) }
        return .files(urls)
      }
      if let png = pasteboard.data(forType: .png),
        let image = ImageAttachments.pending(data: png, type: .png)
      {
        return .images([image], pasted: pasted)
      }
      if let images = pasteboard.readObjects(forClasses: [NSImage.self]) as? [NSImage],
        !images.isEmpty
      {
        let pending = images.compactMap { image in
          image.tiffRepresentation.flatMap { ImageAttachments.pending(data: $0, type: .tiff) }
        }
        return pending.isEmpty ? nil : .images(pending, pasted: pasted)
      }
      return nil
    }

    // MARK: Drawing

    override func draw(_ dirtyRect: NSRect) {
      super.draw(dirtyRect)
      let attributes: [NSAttributedString.Key: Any] = [
        .font: font ?? .systemFont(ofSize: 13), .foregroundColor: mutedColor,
      ]
      let origin = NSPoint(x: textContainerInset.width, y: textContainerInset.height)
      if string.isEmpty {
        let style = NSMutableParagraphStyle()
        style.lineBreakMode = .byTruncatingTail
        var truncating = attributes
        truncating[.paragraphStyle] = style
        let width = bounds.width - textContainerInset.width * 2
        placeholder.draw(
          in: NSRect(origin: origin, size: NSSize(width: width, height: font?.boundingRectForFont.height ?? 18)),
          withAttributes: truncating)
      } else if let argumentHint, let end = endOfTextPoint() {
        argumentHint.draw(at: end, withAttributes: attributes)
      }
    }

    /// Where the next typed character would go, in view coordinates.
    private func endOfTextPoint() -> NSPoint? {
      guard let layout = layoutManager, let container = textContainer,
        layout.numberOfGlyphs > 0
      else { return nil }
      let last = layout.numberOfGlyphs - 1
      let rect = layout.boundingRect(
        forGlyphRange: NSRange(location: last, length: 1), in: container)
      return NSPoint(
        x: rect.maxX + textContainerInset.width, y: rect.minY + textContainerInset.height)
    }
  }
#endif
