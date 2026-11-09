#if DEBUG
  import ArgusCore
  import ArgusKit
  import ArgusUI
  import SwiftUI

  enum ComposerStories {
    static var all: [GalleryStory] {
      [
        GalleryStory("composer/picked-elements", size: CGSize(width: 720, height: 0)) {
          AttachmentStrip(
            images: [], elements: [browser, browserNoReact, device, deviceNoCrop], remove: { _ in }
          )
          .padding(12)
        }
      ]
    }

    private static var browser: PickedElement {
      PickedElement(
        source: .browser, title: "SaveButton · button.btn.primary", context: "", crop: crop(width: 240, height: 70))
    }

    private static var browserNoReact: PickedElement {
      PickedElement(source: .browser, title: "nav#main-navigation.sidebar", context: "", crop: crop(width: 120, height: 400))
    }

    private static var device: PickedElement {
      PickedElement(source: .device, title: "UIButton \"checkout\"", context: "", crop: crop(width: 300, height: 100))
    }

    private static var deviceNoCrop: PickedElement {
      PickedElement(source: .device, title: "RCTViewComponentView", context: "", crop: nil)
    }

    /// A flat placeholder picture standing in for a screenshot crop.
    private static func crop(width: Int, height: Int) -> RemoteImageAttachment? {
      let image = NSImage(size: NSSize(width: width, height: height), flipped: false) { rect in
        NSColor.systemBlue.setFill()
        NSBezierPath(roundedRect: rect.insetBy(dx: 8, dy: 8), xRadius: 6, yRadius: 6).fill()
        return true
      }
      guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
        let png = rep.representation(using: .png, properties: [:])
      else { return nil }
      return RemoteImageAttachment(data: png.base64EncodedString(), mediaType: "image/png")
    }
  }
#endif
