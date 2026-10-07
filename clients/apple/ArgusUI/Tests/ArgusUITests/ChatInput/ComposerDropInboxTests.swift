#if os(macOS)
  import AppKit
  import Testing
  import UniformTypeIdentifiers

  @testable import ArgusUI

  /// Drops on the chat around the composer: what they turn into, and that the
  /// composer is told once per drop.
  @MainActor
  @Suite("ComposerDropInbox")
  struct ComposerDropInboxTests {
    private let png = Data(
      base64Encoded:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")!

    private func temporary(_ ext: String, _ data: Data) throws -> URL {
      let url = FileManager.default.temporaryDirectory.appendingPathComponent(
        "argus-\(UUID().uuidString).\(ext)")
      try data.write(to: url)
      return url
    }

    @Test("image data attaches")
    func imageData() async {
      let provider = NSItemProvider(item: png as NSData, typeIdentifier: UTType.png.identifier)
      guard case .images(let images, false)? = await ComposerDropInbox.drop(from: [provider]) else {
        Issue.record("expected an image")
        return
      }
      #expect(images.first?.attachment.mediaType == "image/png")
    }

    @Test("image files attach; any other file becomes a mention")
    func files() async throws {
      let image = try temporary("png", png)
      let text = try temporary("txt", Data("x".utf8))
      defer {
        try? FileManager.default.removeItem(at: image)
        try? FileManager.default.removeItem(at: text)
      }
      let picture = try #require(NSItemProvider(contentsOf: image))
      guard case .images(let images, false)? = await ComposerDropInbox.drop(from: [picture]) else {
        Issue.record("expected an image file")
        return
      }
      #expect(images.first?.attachment.data == png.base64EncodedString())

      let both = [try #require(NSItemProvider(contentsOf: image)), try #require(NSItemProvider(contentsOf: text))]
      guard case .files(let urls)? = await ComposerDropInbox.drop(from: both) else {
        Issue.record("expected files")
        return
      }
      #expect(urls.count == 2)
    }

    @Test("text alone is refused; each delivery is taken once")
    func delivery() {
      let inbox = ComposerDropInbox()
      #expect(!inbox.accept([NSItemProvider(object: "hello" as NSString)]))
      let before = inbox.generation
      inbox.deliver(.files([URL(fileURLWithPath: "/tmp/a")]))
      #expect(inbox.generation == before + 1)
      #expect(inbox.take().count == 1)
      #expect(inbox.take().isEmpty)
    }
  }
#endif
