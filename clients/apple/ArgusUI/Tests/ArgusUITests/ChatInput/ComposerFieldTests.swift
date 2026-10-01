#if os(macOS)
  import AppKit
  import Testing

  @testable import ArgusUI

  /// The text view itself, driven in-process: which keys reach the composer,
  /// what a pasteboard turns into, and how edits land in the undo history.
  @MainActor
  @Suite("ComposerTextView")
  struct ComposerFieldTests {
    private func key(
      _ code: UInt16, _ characters: String, _ flags: NSEvent.ModifierFlags = []
    ) -> NSEvent {
      NSEvent.keyEvent(
        with: .keyDown, location: .zero, modifierFlags: flags, timestamp: 0, windowNumber: 0,
        context: nil, characters: characters, charactersIgnoringModifiers: characters,
        isARepeat: false, keyCode: code)!
    }

    private func field() -> (ComposerTextView, Recorder) {
      let view = ComposerTextView()
      view.allowsUndo = true
      let recorder = Recorder()
      view.onKey = { key in
        recorder.keys.append(key)
        return recorder.consume
      }
      return (view, recorder)
    }

    final class Recorder {
      var keys: [ComposerKey] = []
      var consume = true
    }

    @Test("Return, ⇧Return, ⌘Return, Tab, arrows and Esc reach the composer")
    func keys() {
      let (view, recorder) = field()
      view.keyDown(with: key(36, "\r"))
      view.keyDown(with: key(36, "\r", .shift))
      view.keyDown(with: key(36, "\r", .command))
      view.keyDown(with: key(48, "\t", .shift))
      view.keyDown(with: key(126, ""))
      view.keyDown(with: key(125, ""))
      view.keyDown(with: key(53, "\u{1b}"))
      #expect(
        recorder.keys == [
          .returnKey(shift: false), .returnKey(shift: true), .returnKey(shift: false),
          .tab(shift: true), .up, .down, .escape,
        ])
    }

    @Test("⌘. is recognised; ⌥↑ moves the caret instead")
    func modifiers() {
      let (view, recorder) = field()
      view.keyDown(with: key(47, ".", .command))
      view.keyDown(with: key(126, "", .option))
      #expect(recorder.keys == [.commandPeriod])
    }

    @Test("a key the composer passes on reaches the text")
    func passThrough() {
      let (view, recorder) = field()
      recorder.consume = false
      view.keyDown(with: key(0, "a"))
      #expect(recorder.keys.isEmpty)
    }

    @Test("pasted image data attaches; text and Finder files don't")
    func pasteboard() throws {
      let board = NSPasteboard(name: .init("argus-test-\(UUID().uuidString)"))
      defer { board.releaseGlobally() }

      board.clearContents()
      board.setString("hello", forType: .string)
      #expect(ComposerTextView.drop(from: board, pasted: true).map { _ in true } == nil)

      let png = try #require(
        Data(
          base64Encoded:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        ))
      board.clearContents()
      board.setData(png, forType: .png)
      guard case .images(let images, true)? = ComposerTextView.drop(from: board, pasted: true)
      else {
        Issue.record("expected a pasted image")
        return
      }
      #expect(images.first?.attachment.mediaType == "image/png")

      let file = FileManager.default.temporaryDirectory.appendingPathComponent(
        "argus-\(UUID().uuidString).txt")
      try Data("x".utf8).write(to: file)
      defer { try? FileManager.default.removeItem(at: file) }
      board.clearContents()
      board.writeObjects([file as NSURL])
      guard case .files(let urls)? = ComposerTextView.drop(from: board, pasted: false) else {
        Issue.record("expected a file drop")
        return
      }
      #expect(urls.map(\.lastPathComponent) == [file.lastPathComponent])

      let image = FileManager.default.temporaryDirectory.appendingPathComponent(
        "argus-\(UUID().uuidString).png")
      try png.write(to: image)
      defer { try? FileManager.default.removeItem(at: image) }
      board.clearContents()
      board.writeObjects([image as NSURL])
      guard case .images(let dropped, false)? = ComposerTextView.drop(from: board, pasted: false)
      else {
        Issue.record("expected a dropped image file")
        return
      }
      #expect(dropped.first?.attachment.data == png.base64EncodedString())
    }

    @Test("accepting a suggestion is undoable; a send clears the history")
    func undo() {
      let view = ComposerTextView()
      view.allowsUndo = true
      let undo = UndoManager()
      undo.groupsByEvent = false
      let delegate = UndoDelegate(undo)
      view.delegate = delegate
      let controller = ComposerController()
      controller.attach(view)

      undo.beginUndoGrouping()
      controller.replace(with: "/review ", caret: 3)
      undo.endUndoGrouping()
      #expect(view.string == "/review ")
      #expect(controller.caret == 3)
      #expect(undo.canUndo)
      undo.undo()
      #expect(view.string == "")

      undo.beginUndoGrouping()
      controller.replace(with: "sent")
      undo.endUndoGrouping()
      controller.reset()
      #expect(view.string == "")
      #expect(!undo.canUndo)
    }

    final class UndoDelegate: NSObject, NSTextViewDelegate {
      let undo: UndoManager
      init(_ undo: UndoManager) { self.undo = undo }
      func undoManager(for view: NSTextView) -> UndoManager? { undo }
    }
  }

#endif
