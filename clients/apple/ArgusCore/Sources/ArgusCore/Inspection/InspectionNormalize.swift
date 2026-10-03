import Foundation

/// The renderer's `normalize.ts`: wraps `windows[]` into one root and fills
/// defaults defensively, so a garbled payload shows the empty state rather
/// than failing.
extension Inspection {
  public static func normalize(_ raw: JSONValue) -> Capture {
    let device = device(raw["device"])
    let inspect = raw["inspect"]
    let roots = (inspect?["windows"]?.arrayValue ?? []).compactMap { window in
      window.objectValue.map { node($0, depth: 0) }
    }
    let hierarchy = roots.count == 1 ? roots[0] : syntheticRoot(roots, device: device)
    return Capture(
      capturedAt: raw["capturedAt"]?.stringValue ?? "",
      device: device,
      hierarchy: hierarchy,
      nodeCount: num(inspect?["nodeCount"]).map { Int($0) } ?? count(hierarchy),
      screenshot: raw["screenshot"]?["data"]?.stringValue.flatMap { Data(base64Encoded: $0) }
    )
  }

  private static func device(_ v: JSONValue?) -> Device {
    Device(
      deviceId: v?["deviceId"]?.stringValue ?? "",
      platform: v?["platform"]?.stringValue ?? "ios",
      width: num(v?["width"]) ?? 0,
      height: num(v?["height"]) ?? 0)
  }

  private static func syntheticRoot(_ children: [Node], device: Device) -> Node {
    let frame = Frame(x: 0, y: 0, w: device.width, h: device.height)
    return Node(
      id: "windows", className: "Windows", frame: frame, absFrame: frame, depth: 0,
      children: children)
  }

  private static func count(_ node: Node) -> Int {
    node.children.reduce(1) { $0 + count($1) }
  }

  private static func node(_ raw: [String: JSONValue], depth: Int) -> Node {
    let children = (raw["children"]?.arrayValue ?? []).compactMap { child in
      child.objectValue.map { node($0, depth: depth + 1) }
    }
    var n = Node(
      id: str(raw["id"]) ?? "node_\(depth)_\(children.count)",
      className: str(raw["class"]) ?? "UIView",
      frame: frame(raw["frame"]),
      absFrame: raw["absFrame"]?.objectValue != nil ? frame(raw["absFrame"]) : nil,
      depth: num(raw["depth"]).map { Int($0) } ?? depth,
      children: children)
    n.z = num(raw["z"])
    n.alpha = num(raw["alpha"])
    n.hidden = raw["hidden"] == .bool(true)
    n.accessibilityIdentifier = str(raw["accessibilityIdentifier"])
    n.accessibilityLabel = str(raw["accessibilityLabel"])
    n.backgroundColor = str(raw["backgroundColor"])
    n.textColor = str(raw["textColor"])
    n.tintColor = str(raw["tintColor"])
    n.titleColor = str(raw["titleColor"])
    // Empty text is still text: a cleared label stays editable.
    n.text = raw["text"]?.stringValue
    n.title = raw["title"]?.stringValue
    n.placeholder = str(raw["placeholder"])
    n.font = font(raw["font"])
    n.image = image(raw["image"])
    if case .bool(let enabled) = raw["enabled"] { n.enabled = enabled }
    n.cornerRadius = num(raw["cornerRadius"])
    n.maskedCorners = num(raw["maskedCorners"])
    n.masksToBounds = raw["masksToBounds"] == .bool(true)
    n.borderWidth = num(raw["borderWidth"])
    n.borderColor = str(raw["borderColor"])
    n.shadowOpacity = num(raw["shadowOpacity"])
    n.shadowRadius = num(raw["shadowRadius"])
    n.shadowColor = str(raw["shadowColor"])
    n.gradientColors = nonEmpty(raw["gradientColors"]?.arrayValue?.compactMap(\.stringValue))
    n.transform3D = nonEmpty(raw["transform3D"]?.arrayValue?.compactMap { num($0) })
    if let x = num(raw["anchorPoint"]?["x"]), let y = num(raw["anchorPoint"]?["y"]) {
      n.anchorPoint = Point(x: x, y: y)
    }
    n.hasMask = raw["hasMask"] == .bool(true)
    n.rn = reactNative(raw["rn"])
    n.truncated = num(raw["truncated"]).map { Int($0) }
    return n
  }

  private static func frame(_ v: JSONValue?) -> Frame {
    Frame(
      x: num(v?["x"]) ?? 0, y: num(v?["y"]) ?? 0, w: num(v?["w"]) ?? 0, h: num(v?["h"]) ?? 0)
  }

  private static func font(_ v: JSONValue?) -> Font? {
    guard let v, v.objectValue != nil else { return nil }
    return Font(
      name: str(v["name"]) ?? "", family: str(v["family"]) ?? "", size: num(v["size"]) ?? 0,
      bold: v["bold"] == .bool(true), italic: v["italic"] == .bool(true),
      weight: num(v["weight"]))
  }

  private static func image(_ v: JSONValue?) -> Image? {
    guard let v, v.objectValue != nil else { return nil }
    return Image(
      w: num(v["w"]) ?? 0, h: num(v["h"]) ?? 0, scale: num(v["scale"]) ?? 1,
      name: str(v["name"]))
  }

  private static func reactNative(_ v: JSONValue?) -> ReactNative? {
    guard let v else { return nil }
    let rn = ReactNative(
      reactTag: str(v["reactTag"]), nativeID: str(v["nativeID"]), testID: str(v["testID"]))
    return (rn.reactTag ?? rn.nativeID ?? rn.testID) == nil ? nil : rn
  }

  private static func num(_ v: JSONValue?) -> Double? {
    if case .number(let d) = v, d.isFinite { return d }
    return nil
  }

  private static func str(_ v: JSONValue?) -> String? {
    guard let s = v?.stringValue, !s.isEmpty else { return nil }
    return s
  }

  private static func nonEmpty<T>(_ list: [T]?) -> [T]? {
    guard let list, !list.isEmpty else { return nil }
    return list
  }
}
