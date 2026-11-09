import ArgusCore
import ArgusKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// A UI element picked in the browser or the device inspector, riding the
/// draft as a chip: the agent gets `context` and the `crop` as an image.
public struct PickedElement: Identifiable, Hashable, Sendable {
  public enum Source: String, Sendable {
    case browser
    case device
  }

  public let id = UUID()
  public var source: Source
  /// The chip's label, e.g. `button.primary` or `UIButton "Save"`.
  public var title: String
  /// What the agent reads to find the element in code.
  public var context: String
  public var crop: RemoteImageAttachment?

  public init(source: Source, title: String, context: String, crop: RemoteImageAttachment?) {
    self.source = source
    self.title = title
    self.context = context
    self.crop = crop
  }
}

extension PickedElement {
  /// The message an agent gets: what was typed, then each element's context.
  static func body(typed: String, elements: [PickedElement]) -> String {
    let blocks = elements.map(\.context)
    return ([typed.isEmpty ? "(see the picked element)" : typed] + blocks).joined(separator: "\n\n")
  }

  /// What the transcript shows instead of the context blocks.
  static func display(typed: String, elements: [PickedElement]) -> String {
    let chips = elements.map { "[Element: \($0.title)]" }.joined(separator: " ")
    return typed.isEmpty ? chips : "\(typed)\n\n\(chips)"
  }

  // MARK: Browser

  public static func browser(_ element: ArgusProtocol.BrowserElement) -> PickedElement {
    var lines = ["[Picked element — browser, \(element.url)]", "Selector: `\(element.selector)`"]
    if let component = element.component {
      lines.append("React component: \(component)" + (element.source.map { " (\($0))" } ?? ""))
    }
    if let text = element.text, !text.isEmpty { lines.append("Text: \"\(text)\"") }
    let b = element.bounds
    lines.append(
      "Bounds: x \(format(b.x)), y \(format(b.y)), \(format(b.width))×\(format(b.height)) CSS px "
        + "in a \(format(element.viewport.width))×\(format(element.viewport.height)) viewport")
    if !element.attributes.isEmpty {
      lines.append("Attributes: " + element.attributes.sorted { $0.key < $1.key }.map { "\($0.key)=\"\($0.value)\"" }
        .joined(separator: " "))
    }
    if !element.styles.isEmpty {
      lines.append("Computed styles: " + element.styles.sorted { $0.key < $1.key }.map { "\($0.key): \($0.value)" }
        .joined(separator: "; "))
    }
    lines.append("HTML:\n```html\n\(element.html)\n```")
    let crop = element.screenshot.map { RemoteImageAttachment(data: $0, mediaType: "image/png") }
    if crop != nil { lines.append("A screenshot of the element is attached.") }
    return PickedElement(
      source: .browser, title: element.component.map { "\($0) · \(element.label)" } ?? element.label,
      context: lines.joined(separator: "\n"), crop: crop)
  }

  // MARK: Device

  /// A node of an inspector capture; `path` runs root → node.
  public static func device(
    _ node: Inspection.Node, path: [Inspection.Node], capture: Inspection.Capture
  ) -> PickedElement {
    let platform = capture.device.platform.lowercased() == "tvos" ? "tvOS" : "iOS"
    var lines = ["[Picked element — \(platform) simulator]", "Class: \(node.className)"]
    lines.append("View path: " + path.map(\.className).joined(separator: " > "))
    if let id = node.accessibilityIdentifier { lines.append("Accessibility identifier: \(id)") }
    if let label = node.accessibilityLabel { lines.append("Accessibility label: \(label)") }
    if let rn = node.rn {
      if let testID = rn.testID { lines.append("testID: \(testID)") }
      if let nativeID = rn.nativeID { lines.append("nativeID: \(nativeID)") }
    }
    if let text = node.text ?? node.title ?? node.placeholder, !text.isEmpty { lines.append("Text: \"\(text)\"") }
    let r = node.rect
    lines.append(
      "Frame: x \(format(r.x)), y \(format(r.y)), \(format(r.w))×\(format(r.h)) pt "
        + "on a \(format(capture.device.width))×\(format(capture.device.height)) pt screen")
    let colors = [
      ("background", node.backgroundColor), ("text", node.textColor), ("tint", node.tintColor),
      ("title", node.titleColor),
    ].compactMap { name, value in value.map { "\(name) \($0)" } }
    if !colors.isEmpty { lines.append("Colors: " + colors.joined(separator: ", ")) }
    if let font = node.font {
      lines.append("Font: \(font.name) \(format(font.size))pt" + (font.bold ? " bold" : "") + (font.italic ? " italic" : ""))
    }
    if let radius = node.cornerRadius, radius > 0 { lines.append("Corner radius: \(format(radius))") }
    let crop = capture.screenshot.flatMap {
      cropPNG($0, rect: r, screen: CGSize(width: capture.device.width, height: capture.device.height))
    }
    if crop != nil { lines.append("A screenshot of the element is attached.") }
    let name = node.accessibilityIdentifier ?? node.rn?.testID ?? node.accessibilityLabel ?? node.text ?? node.title
    return PickedElement(
      source: .device, title: name.map { "\(node.className) \"\($0)\"" } ?? node.className,
      context: lines.joined(separator: "\n"),
      crop: crop.map { RemoteImageAttachment(data: $0.base64EncodedString(), mediaType: "image/png") })
  }

  /// Padding around a crop, in points, so the element reads in context.
  static let cropPadding: Double = 8

  /// The rect (in screen points) cut out of a screenshot of the whole screen, as PNG.
  static func cropPNG(_ png: Data, rect: Inspection.Frame, screen: CGSize) -> Data? {
    guard screen.width > 0, screen.height > 0,
      let source = CGImageSourceCreateWithData(png as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { return nil }
    let scale = Double(image.width) / screen.width
    let pad = cropPadding
    let wanted = CGRect(
      x: (rect.x - pad) * scale, y: (rect.y - pad) * scale,
      width: (rect.w + pad * 2) * scale, height: (rect.h + pad * 2) * scale)
    let clipped = wanted.intersection(CGRect(x: 0, y: 0, width: image.width, height: image.height)).integral
    guard clipped.width >= 1, clipped.height >= 1, let cropped = image.cropping(to: clipped) else { return nil }
    let out = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(out, UTType.png.identifier as CFString, 1, nil)
    else { return nil }
    CGImageDestinationAddImage(destination, cropped, nil)
    return CGImageDestinationFinalize(destination) ? out as Data : nil
  }

  private static func format(_ value: Double) -> String {
    value.rounded() == value ? String(Int(value)) : String(format: "%.1f", value)
  }
}
