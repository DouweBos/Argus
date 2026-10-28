import ArgusKit
import Foundation
import Observation

/// Figma links the design viewer opens in place of the browser.
public enum FigmaLink {
  /// A figma.com design, file or prototype link.
  public static func isDesign(_ url: URL) -> Bool {
    guard let host = url.host()?.lowercased(), host == "figma.com" || host.hasSuffix(".figma.com") else {
      return false
    }
    let first = url.pathComponents.dropFirst().first
    return ["design", "file", "proto"].contains(first)
  }

  public static func isDesign(_ raw: String) -> Bool {
    URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)).map(isDesign) ?? false
  }
}

/// A device the computer can screenshot for a compare.
public struct DesignCompareTarget: Hashable, Identifiable, Sendable {
  public var platform: RemotePlatform
  public var deviceKey: String
  public var name: String

  public var id: String { "\(platform.rawValue):\(deviceKey)" }

  public init(platform: RemotePlatform, deviceKey: String, name: String) {
    self.platform = platform
    self.deviceKey = deviceKey
    self.name = name
  }
}

/// One Figma frame in the design viewer: its render, layers, comments and
/// the file's other frames to move to, plus a compare against a device.
@MainActor
@Observable
public final class DesignViewerModel {
  public private(set) var url: String
  /// The file version the session captured the frame at; nil outside a session.
  public let sessionVersion: String?
  public private(set) var details: HostStore.FigmaFrameDetails?
  /// The frame as PNG bytes, decoded once.
  public private(set) var image: Data?
  public private(set) var loadError: String?
  public private(set) var comparison: HostStore.DesignComparison?
  public private(set) var comparing = false
  public private(set) var compareError: String?
  /// Frames visited before this one, to step back to.
  public private(set) var history: [String] = []

  private unowned let host: HostStore

  public init(url: String, sessionVersion: String? = nil, host: HostStore) {
    self.url = url
    self.sessionVersion = sessionVersion
    self.host = host
  }

  /// The file version `session` captured `url`'s frame at; its first frame's when the link isn't one of its own.
  public static func sessionVersion(of url: String, in session: RemoteSession) -> String? {
    session.designRefs?.first { $0.url == url }?.version ?? session.designRefs?.first?.version
  }

  /// The designer has published a newer version of the file since the session started.
  public var designChanged: Bool {
    guard let sessionVersion, let current = details?.file.version else { return false }
    return sessionVersion != current
  }

  public var lastModified: Date? {
    details.map { Date(timeIntervalSince1970: $0.file.lastModified / 1000) }
  }

  /// Share of differing pixels as a whole percentage, for the compare's label.
  public var differingPercent: Int? {
    comparison.map { Int(($0.differingFraction * 100).rounded()) }
  }

  public func load() async {
    let asked = url
    do {
      let found = try await host.figmaFrameDetails(url: asked)
      guard asked == url else { return }
      details = found
      image = found.flatMap { Data(base64Encoded: $0.frame.image) }
      loadError = found == nil ? "Figma couldn't render this link. Open a frame link, with node-id in it." : nil
    } catch {
      guard asked == url else { return }
      loadError = HostStore.describe(error)
    }
  }

  /// Another frame of the file, keeping this one to step back to.
  public func open(_ frameURL: String) async {
    guard frameURL != url else { return }
    history.append(url)
    await show(frameURL)
  }

  public func back() async {
    guard let previous = history.popLast() else { return }
    await show(previous)
  }

  public func compare(with target: DesignCompareTarget) async {
    comparing = true
    defer { comparing = false }
    let asked = url
    do {
      let result = try await host.compareDesign(url: asked, platform: target.platform, deviceKey: target.deviceKey)
      guard asked == url else { return }
      comparison = result
      compareError = nil
    } catch {
      guard asked == url else { return }
      compareError = HostStore.describe(error)
    }
  }

  public func clearComparison() {
    comparison = nil
    compareError = nil
  }

  /// Whether `frameURL` is the frame on screen, for marking it in the file's outline.
  public func isCurrent(_ frameURL: String) -> Bool {
    guard let nodeId = details?.ref.nodeId else { return false }
    return Self.nodeId(frameURL) == nodeId
  }

  /// `1:2` from a link's `node-id=1-2`.
  static func nodeId(_ raw: String) -> String? {
    URLComponents(string: raw)?.queryItems?.first { $0.name == "node-id" }?.value?
      .replacingOccurrences(of: "-", with: ":")
  }

  private func show(_ next: String) async {
    url = next
    details = nil
    image = nil
    loadError = nil
    clearComparison()
    await load()
  }
}
