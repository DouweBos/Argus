// Renders every Argus app icon from one definition: the macOS .icns/.png, the
// Icon Composer bundle (light + dark), and the iOS app icon set.
//
// Run with: pnpm build:icon   (or `swift scripts/render-icon.swift`)
import AppKit
import CoreGraphics
import ImageIO

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let build = root.appendingPathComponent("build")
let iosIcons = root.appendingPathComponent("clients/argus-ios/Resources/Assets.xcassets/AppIcon.appiconset")

// MARK: - Palette (Peacock tokens: --accent, --accent-gradient, --bg-primary)

func hex(_ s: String, _ a: CGFloat = 1) -> CGColor {
    var v: UInt64 = 0
    Scanner(string: s).scanHexInt64(&v)
    return CGColor(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255,
                   blue: CGFloat(v & 0xff) / 255, alpha: a)
}

struct Theme {
    var bg: [String]
    var glyph: [String]
    var glow: CGColor
    var glyphShadow: Bool
}
let dark = Theme(bg: ["262632", "101016"], glyph: ["f5a623", "ff7a4d"], glow: hex("ff7a4d", 0.28), glyphShadow: true)
let light = Theme(bg: ["ffffff", "eceef3"], glyph: ["f5a623", "ff7a4d"], glow: hex("f5a623", 0.14), glyphShadow: false)
let tinted = Theme(bg: ["000000", "000000"], glyph: ["ffffff", "d6d6d6"], glow: hex("ffffff", 0), glyphShadow: false)

// MARK: - Geometry (1024 canvas, macOS grid: 824 body, 22.5% corner radius)

let C = CGPoint(x: 512, y: 512)
let body = CGRect(x: 100, y: 100, width: 824, height: 824)
let radius: CGFloat = 824 * 0.225

func circle(_ c: CGPoint, _ r: CGFloat) -> CGPath {
    CGPath(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r), transform: nil)
}

/// Circle of radius r with its point k above the centre — a peacock-feather eye.
func teardrop(_ c: CGPoint, _ r: CGFloat, _ k: CGFloat) -> CGPath {
    let py = r * r / k, px = (r * r - py * py).squareRoot()
    let tip = CGMutablePath()
    tip.addLines(between: [CGPoint(x: c.x, y: c.y + k), CGPoint(x: c.x + px, y: c.y + py), CGPoint(x: c.x - px, y: c.y + py)])
    tip.closeSubpath()
    return circle(c, r).union(tip)
}

/// The Argus eye in body space: an outlined feather eye with a solid pupil.
func eye() -> CGPath {
    let c = CGPoint(x: 512, y: 455), s: CGFloat = 0.86
    return teardrop(c, 250 * s, 470 * s).subtracting(teardrop(c, 158 * s, 300 * s)).union(circle(c, 88 * s))
}

// MARK: - Drawing

let extend: CGGradientDrawingOptions = [.drawsBeforeStartLocation, .drawsAfterEndLocation]

func gradient(_ cs: [CGColor]) -> CGGradient {
    CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: cs as CFArray, locations: nil)!
}

func context(_ size: Int) -> CGContext {
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.interpolationQuality = .high
    return ctx
}

func drawBackground(_ t: Theme, _ ctx: CGContext, in area: CGRect) {
    ctx.drawLinearGradient(gradient(t.bg.map { hex($0) }), start: CGPoint(x: area.midX, y: area.maxY),
                           end: CGPoint(x: area.midX, y: area.minY), options: extend)
}

func drawGlow(_ t: Theme, _ ctx: CGContext) {
    ctx.drawRadialGradient(gradient([t.glow, t.glow.copy(alpha: 0)!]), startCenter: C, startRadius: 0,
                           endCenter: C, endRadius: 420, options: [])
}

func drawGlyph(_ t: Theme, _ ctx: CGContext) {
    let path = eye(), b = path.boundingBoxOfPath
    ctx.saveGState()
    if t.glyphShadow { ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: hex("000000", 0.22)) }
    ctx.beginTransparencyLayer(auxiliaryInfo: nil)
    ctx.addPath(path)
    ctx.clip()
    ctx.drawLinearGradient(gradient(t.glyph.map { hex($0) }), start: CGPoint(x: b.midX, y: b.maxY),
                           end: CGPoint(x: b.midX, y: b.minY), options: extend)
    ctx.endTransparencyLayer()
    ctx.restoreGState()
}

/// macOS tile: rounded body with a soft drop shadow and top sheen.
func macIcon(_ t: Theme) -> CGImage {
    let ctx = context(1024), shape = CGPath(roundedRect: body, cornerWidth: radius, cornerHeight: radius, transform: nil)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: hex("000000", 0.35))
    ctx.addPath(shape)
    ctx.setFillColor(hex(t.bg[1]))
    ctx.fillPath()
    ctx.restoreGState()
    ctx.addPath(shape)
    ctx.clip()
    drawBackground(t, ctx, in: body)
    drawGlow(t, ctx)
    ctx.drawLinearGradient(gradient([hex("ffffff", 0.14), hex("ffffff", 0)]), start: CGPoint(x: 512, y: body.maxY),
                           end: CGPoint(x: 512, y: body.midY), options: [])
    drawGlyph(t, ctx)
    return ctx.makeImage()!
}

/// Maps the 824 body onto the full canvas — Icon Composer and iOS apply their own mask.
func fullBleed(_ ctx: CGContext) {
    let s = 1024 / body.width
    ctx.translateBy(x: 512, y: 512)
    ctx.scaleBy(x: s, y: s)
    ctx.translateBy(x: -512, y: -512)
}

func layer(_ t: Theme, background: Bool, glyph: Bool, glow: Bool) -> CGImage {
    let ctx = context(1024)
    fullBleed(ctx)
    if background { drawBackground(t, ctx, in: body) }
    if glow { drawGlow(t, ctx) }
    if glyph { drawGlyph(t, ctx) }
    return ctx.makeImage()!
}

func downscale(_ img: CGImage, _ size: Int) -> CGImage {
    let ctx = context(size)
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: size, height: size))
    return ctx.makeImage()!
}

/// iOS rejects app icons with an alpha channel, so opaque renders drop it.
func opaque(_ img: CGImage) -> CGImage {
    let ctx = CGContext(data: nil, width: img.width, height: img.height, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: img.width, height: img.height))
    return ctx.makeImage()!
}

func write(_ img: CGImage, _ url: URL) {
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let dest = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, img, nil)
    guard CGImageDestinationFinalize(dest) else { fatalError("failed to write \(url.path)") }
    print("wrote \(url.path.replacingOccurrences(of: root.path + "/", with: ""))")
}

func run(_ tool: String, _ args: [String]) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    p.arguments = [tool] + args
    try! p.run()
    p.waitUntilExit()
    guard p.terminationStatus == 0 else { fatalError("\(tool) failed") }
}

// MARK: - macOS: icon.png, iconset, icns

let master = macIcon(dark)
write(master, build.appendingPathComponent("icon.png"))
let iconset = build.appendingPathComponent("icon.iconset")
for base in [16, 32, 128, 256, 512] {
    write(downscale(master, base), iconset.appendingPathComponent("icon_\(base)x\(base).png"))
    write(downscale(master, base * 2), iconset.appendingPathComponent("icon_\(base)x\(base)@2x.png"))
}
run("iconutil", ["-c", "icns", iconset.path, "-o", build.appendingPathComponent("icon.icns").path])
print("wrote build/icon.icns")

// MARK: - macOS: Icon Composer bundle (switches with the system appearance)

let bundle = build.appendingPathComponent("AppIcon.icon")
let assets = bundle.appendingPathComponent("Assets")
for (name, t) in [("light", light), ("dark", dark)] {
    write(layer(t, background: false, glyph: true, glow: false), assets.appendingPathComponent("glyph-\(name).png"))
    write(layer(t, background: false, glyph: false, glow: true), assets.appendingPathComponent("glow-\(name).png"))
}

func srgb(_ h: String) -> String {
    let c = hex(h).components!
    return "srgb:" + c.map { String(format: "%.5f", $0) }.joined(separator: ",")
}
func fill(_ t: Theme) -> [String: Any] {
    ["linear-gradient": t.bg.map(srgb), "orientation": ["start": ["x": 0.5, "y": 0], "stop": ["x": 0.5, "y": 1]]]
}
func group(_ name: String, shadow: [String: Any]) -> [String: Any] {
    [
        "name": name,
        "layers": [[
            "name": name,
            "glass": false,
            "image-name-specializations": [["value": "\(name.lowercased())-light.png"],
                                           ["appearance": "dark", "value": "\(name.lowercased())-dark.png"]],
        ]],
        "shadow": shadow,
        "specular": false,
        "translucency": ["enabled": false, "value": 0],
    ]
}
let iconJSON: [String: Any] = [
    "fill-specializations": [["value": fill(light)], ["appearance": "dark", "value": fill(dark)]],
    "groups": [group("Glyph", shadow: ["kind": "neutral", "opacity": 0.25]), group("Glow", shadow: ["kind": "none", "opacity": 0])],
    "supported-platforms": ["squares": ["macOS"]],
]
let json = try! JSONSerialization.data(withJSONObject: iconJSON, options: [.prettyPrinted, .sortedKeys])
try! json.write(to: bundle.appendingPathComponent("icon.json"))
print("wrote build/AppIcon.icon/icon.json")

// MARK: - iOS: full-bleed square (iOS masks it), plus dark and tinted appearances

write(opaque(layer(dark, background: true, glyph: true, glow: true)), iosIcons.appendingPathComponent("AppIcon-1024.png"))
write(layer(dark, background: false, glyph: true, glow: true), iosIcons.appendingPathComponent("AppIcon-1024-dark.png"))
write(opaque(layer(tinted, background: true, glyph: true, glow: false)), iosIcons.appendingPathComponent("AppIcon-1024-tinted.png"))
