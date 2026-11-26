import AVFoundation
import AppKit
import ArgusCore
import ScreenCaptureKit
import SwiftUI

/// One app window, live through ScreenCaptureKit, drawn straight from its
/// frames. Nothing is encoded or sent anywhere: the picture stays in this process.
struct MacAppMirrorSurface: NSViewRepresentable {
  enum Event: Equatable {
    case firstFrame
    /// The window moved or resized, in global points.
    case moved(CGRect)
    case failed(String)
    case closed
  }

  let windowId: UInt32
  let onEvent: @MainActor (Event) -> Void

  func makeNSView(context: Context) -> MirrorView {
    let view = MirrorView()
    view.onEvent = onEvent
    view.show(windowId)
    return view
  }

  func updateNSView(_ view: MirrorView, context: Context) {
    view.onEvent = onEvent
    view.show(windowId)
  }

  static func dismantleNSView(_ view: MirrorView, coordinator: ()) {
    view.stop()
  }

  final class MirrorView: NSView {
    private let displayLayer = AVSampleBufferDisplayLayer()
    private var capture: WindowCapture?
    private var windowId: UInt32?
    var onEvent: (@MainActor (Event) -> Void)?

    override init(frame: NSRect) {
      super.init(frame: frame)
      wantsLayer = true
      displayLayer.videoGravity = .resizeAspect
    }

    required init?(coder: NSCoder) { nil }

    override func makeBackingLayer() -> CALayer { displayLayer }

    func show(_ id: UInt32) {
      guard id != windowId else { return }
      stop()
      windowId = id
      displayLayer.sampleBufferRenderer.flush(removingDisplayedImage: true) {}
      let capture = WindowCapture(windowId: id, renderer: displayLayer.sampleBufferRenderer) { [weak self] event in
        self?.onEvent?(event)
      }
      self.capture = capture
      Task { await capture.start() }
    }

    func stop() {
      capture?.stop()
      capture = nil
      windowId = nil
    }
  }
}

/// Owns one `SCStream`. Frames are handed to the layer's renderer on the
/// capture queue; everything else happens on the main actor.
private final class WindowCapture: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
  private let windowId: UInt32
  private nonisolated(unsafe) let renderer: AVSampleBufferVideoRenderer
  private let queue = DispatchQueue(label: "argus.mac-app-mirror")
  private let onEvent: @MainActor (MacAppMirrorSurface.Event) -> Void
  @MainActor private var stream: SCStream?
  @MainActor private var watcher: Task<Void, Never>?
  @MainActor private var stopped = false
  @MainActor private var frame = CGRect.zero
  @MainActor private var pixelScale: CGFloat = 2
  /// Capture queue only.
  private var sentFirstFrame = false

  /// A window's own moves and resizes are only picked up by looking; twice a second keeps up with a drag.
  private static let watchInterval = Duration.milliseconds(500)

  init(
    windowId: UInt32, renderer: AVSampleBufferVideoRenderer,
    onEvent: @escaping @MainActor (MacAppMirrorSurface.Event) -> Void
  ) {
    self.windowId = windowId
    self.renderer = renderer
    self.onEvent = onEvent
  }

  @MainActor func start() async {
    do {
      let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
      guard !stopped else { return }
      guard let window = content.windows.first(where: { $0.windowID == windowId }) else {
        onEvent(.closed)
        return
      }
      let filter = SCContentFilter(desktopIndependentWindow: window)
      pixelScale = CGFloat(filter.pointPixelScale)
      let stream = SCStream(
        filter: filter, configuration: Self.configuration(window.frame.size, scale: pixelScale), delegate: self)
      try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
      try await stream.startCapture()
      guard !stopped else {
        try? await stream.stopCapture()
        return
      }
      self.stream = stream
      // CoreGraphics' bounds are what posted events are placed by.
      frame = MacApps.frame(of: windowId) ?? window.frame
      onEvent(.moved(frame))
      watch()
    } catch {
      if !stopped { onEvent(.failed(error.localizedDescription)) }
    }
  }

  @MainActor func stop() {
    stopped = true
    watcher?.cancel()
    nonisolated(unsafe) let stream = stream
    self.stream = nil
    Task { try? await stream?.stopCapture() }
  }

  private static func configuration(_ size: CGSize, scale: CGFloat) -> SCStreamConfiguration {
    let config = SCStreamConfiguration()
    config.width = max(2, Int(size.width * scale))
    config.height = max(2, Int(size.height * scale))
    config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
    config.pixelFormat = kCVPixelFormatType_32BGRA
    config.showsCursor = false
    config.queueDepth = 5
    return config
  }

  @MainActor private func watch() {
    watcher = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: Self.watchInterval)
        guard let self, !Task.isCancelled else { return }
        guard let now = MacApps.frame(of: self.windowId) else {
          self.onEvent(.closed)
          return
        }
        guard now != self.frame else { continue }
        let resized = now.size != self.frame.size
        self.frame = now
        self.onEvent(.moved(now))
        if resized, let stream = self.stream {
          try? await stream.updateConfiguration(Self.configuration(now.size, scale: self.pixelScale))
        }
      }
    }
  }

  // MARK: SCStreamOutput, SCStreamDelegate

  func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, sampleBuffer.isValid, Self.isComplete(sampleBuffer) else { return }
    if let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: true)
      as? [CFMutableDictionary], let first = attachments.first
    {
      CFDictionarySetValue(
        first, Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
        Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
    }
    // A failed renderer never recovers on its own.
    if renderer.status == .failed { renderer.flush() }
    renderer.enqueue(sampleBuffer)
    if !sentFirstFrame {
      sentFirstFrame = true
      Task { @MainActor in self.onEvent(.firstFrame) }
    }
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    let message = error.localizedDescription
    Task { @MainActor in
      guard !self.stopped else { return }
      self.onEvent(MacApps.frame(of: self.windowId) == nil ? .closed : .failed(message))
    }
  }

  /// Idle and blank frames carry no picture; only complete ones are drawn.
  private static func isComplete(_ sampleBuffer: CMSampleBuffer) -> Bool {
    guard
      let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false)
        as? [[SCStreamFrameInfo: Any]],
      let raw = attachments.first?[.status] as? Int
    else { return false }
    return SCFrameStatus(rawValue: raw) == .complete
  }
}
