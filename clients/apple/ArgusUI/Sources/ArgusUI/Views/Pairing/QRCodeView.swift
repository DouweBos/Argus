#if os(macOS)
  import AppKit
  import CoreImage.CIFilterBuiltins
  import SwiftUI

  /// A QR code drawn by CoreImage, scaled with crisp modules. Always dark on
  /// light whatever the theme: scanners need the contrast, so it sits on a
  /// light tile like a printed code.
  public struct QRCodeView: View {
    let payload: String
    var size: CGFloat

    public init(payload: String, size: CGFloat = 200) {
      self.payload = payload
      self.size = size
    }

    public var body: some View {
      if let image = Self.image(payload) {
        Image(nsImage: image)
          .interpolation(.none)
          .resizable()
          .frame(width: size, height: size)
          .padding(12)
          .background(Theme.light.bg, in: .rect(cornerRadius: 8))
          .accessibilityLabel("Pairing QR code")
      }
    }

    public static func image(_ payload: String) -> NSImage? {
      let filter = CIFilter.qrCodeGenerator()
      filter.message = Data(payload.utf8)
      filter.correctionLevel = "M"
      guard let output = filter.outputImage,
        let cg = CIContext().createCGImage(output, from: output.extent)
      else { return nil }
      return NSImage(cgImage: cg, size: NSSize(width: output.extent.width, height: output.extent.height))
    }
  }
#endif
