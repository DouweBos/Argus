import ArgusCore
import AVFoundation
import SwiftUI
import VideoToolbox

#if canImport(UIKit)
  import UIKit
#else
  import AppKit
#endif

/// A native H.264 surface.
///
/// Frames are decrypted in-process and handed straight to VideoToolbox as
/// typed data — no base64, no intermediate image. SwiftUI has no equivalent of
/// `AVSampleBufferDisplayLayer`, so this wraps a platform view.
public struct DeviceVideoView {
  /// Handed back so the screen can push frames in as they arrive.
  @MainActor
  public final class Handle {
    fileprivate weak var view: VideoView?

    public init() {}

    public func configure(codec: String, width: Int, height: Int, description: Data) {
      view?.configure(codec: codec, width: width, height: height, description: description)
    }

    public func enqueue(_ data: Data, isKeyFrame: Bool, timestampMillis: Double) {
      view?.enqueue(data, isKeyFrame: isKeyFrame, timestampMillis: timestampMillis)
    }

    /// Feed one stream message; JPEGs are the browser's and not drawn here.
    public func receive(_ message: MediaMessage) {
      switch message {
      case .config(_, let codec, let width, let height, let description):
        configure(codec: codec, width: width, height: height, description: description)
      case .frame(_, let keyFrame, let timestamp, let data):
        enqueue(data, isKeyFrame: keyFrame, timestampMillis: timestamp)
      case .jpeg:
        break
      }
    }
  }

  public let handle: Handle
  public let onFirstFrame: () -> Void

  public init(handle: Handle, onFirstFrame: @escaping () -> Void) {
    self.handle = handle
    self.onFirstFrame = onFirstFrame
  }

  @MainActor
  fileprivate func makeView() -> VideoView {
    let view = VideoView()
    view.onFirstFrame = onFirstFrame
    handle.view = view
    return view
  }

  public final class VideoView: PlatformVideoBaseView {
    #if canImport(UIKit)
      public override class var layerClass: AnyClass { AVSampleBufferDisplayLayer.self }

      private var displayLayer: AVSampleBufferDisplayLayer {
        layer as! AVSampleBufferDisplayLayer
      }
    #else
      private let displayLayer = AVSampleBufferDisplayLayer()

      public override func makeBackingLayer() -> CALayer { displayLayer }
    #endif

    private var formatDescription: CMFormatDescription?
    private var nalUnitLengthSize: Int = 4
    /// A decoder handed a delta frame before its first keyframe produces
    /// nothing but artefacts, so wait for one.
    private var awaitingKeyFrame = true
    private var firstFrameSent = false
    public var onFirstFrame: (() -> Void)?

    public override init(frame: CGRect) {
      super.init(frame: frame)
      #if canImport(UIKit)
        backgroundColor = .black
      #else
        wantsLayer = true
        displayLayer.backgroundColor = NSColor.black.cgColor
      #endif
      displayLayer.videoGravity = .resizeAspect
    }

    public required init?(coder: NSCoder) { fatalError("init(coder:) is unused") }

    public func configure(codec: String, width: Int, height: Int, description: Data) {
      // Only AVC ever comes over this channel; anything else is a desktop bug
      // we shouldn't paper over by guessing.
      guard codec.hasPrefix("avc"), let parsed = AvccDescription.parse(description) else {
        return
      }
      nalUnitLengthSize = parsed.nalUnitLengthSize

      var format: CMFormatDescription?
      let created = withUnsafeParameterSets(parsed.parameterSets) { pointers, sizes in
        CMVideoFormatDescriptionCreateFromH264ParameterSets(
          allocator: kCFAllocatorDefault,
          parameterSetCount: pointers.count,
          parameterSetPointers: pointers.baseAddress!,
          parameterSetSizes: sizes.baseAddress!,
          nalUnitHeaderLength: Int32(parsed.nalUnitLengthSize),
          formatDescriptionOut: &format)
      }
      guard created == noErr, let format else { return }

      formatDescription = format
      awaitingKeyFrame = true
      displayLayer.sampleBufferRenderer.flush()
    }

    public func enqueue(_ data: Data, isKeyFrame: Bool, timestampMillis: Double) {
      guard let formatDescription else { return }
      if awaitingKeyFrame {
        guard isKeyFrame else { return }
        awaitingKeyFrame = false
      }
      // A failed layer never recovers on its own; flush and wait for the next
      // keyframe rather than freezing on the last good frame.
      if displayLayer.sampleBufferRenderer.status == .failed {
        displayLayer.sampleBufferRenderer.flush()
        awaitingKeyFrame = true
        return
      }

      var blockBuffer: CMBlockBuffer?
      var payload = [UInt8](data)
      guard
        CMBlockBufferCreateWithMemoryBlock(
          allocator: kCFAllocatorDefault,
          memoryBlock: nil,
          blockLength: payload.count,
          blockAllocator: kCFAllocatorDefault,
          customBlockSource: nil,
          offsetToData: 0,
          dataLength: payload.count,
          flags: 0,
          blockBufferOut: &blockBuffer) == noErr,
        let blockBuffer,
        CMBlockBufferReplaceDataBytes(
          with: &payload, blockBuffer: blockBuffer, offsetIntoDestination: 0,
          dataLength: payload.count) == noErr
      else { return }

      var sampleBuffer: CMSampleBuffer?
      var sampleSize = payload.count
      // Timestamps arrive in milliseconds on the wire.
      var timing = CMSampleTimingInfo(
        duration: .invalid,
        presentationTimeStamp: CMTime(
          value: CMTimeValue(timestampMillis * 1000), timescale: 1_000_000),
        decodeTimeStamp: .invalid)

      guard
        CMSampleBufferCreateReady(
          allocator: kCFAllocatorDefault,
          dataBuffer: blockBuffer,
          formatDescription: formatDescription,
          sampleCount: 1,
          sampleTimingEntryCount: 1,
          sampleTimingArray: &timing,
          sampleSizeEntryCount: 1,
          sampleSizeArray: &sampleSize,
          sampleBufferOut: &sampleBuffer) == noErr,
        let sampleBuffer
      else { return }

      if let attachments = CMSampleBufferGetSampleAttachmentsArray(
        sampleBuffer, createIfNecessary: true) as? [CFMutableDictionary], let first = attachments.first
      {
        CFDictionarySetValue(
          first,
          Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
          Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
      }

      displayLayer.sampleBufferRenderer.enqueue(sampleBuffer)
      if !firstFrameSent {
        firstFrameSent = true
        onFirstFrame?()
      }
    }
  }
}

#if canImport(UIKit)
  public typealias PlatformVideoBaseView = UIView

  extension DeviceVideoView: UIViewRepresentable {
    public func makeUIView(context: Context) -> VideoView { makeView() }
    public func updateUIView(_ view: VideoView, context: Context) {}
  }
#else
  public typealias PlatformVideoBaseView = NSView

  extension DeviceVideoView: NSViewRepresentable {
    public func makeNSView(context: Context) -> VideoView { makeView() }
    public func updateNSView(_ view: VideoView, context: Context) {}
  }
#endif

/// VideoToolbox wants parallel pointer and size arrays that stay valid for the
/// duration of the call, which Swift arrays of arrays don't give us directly.
private func withUnsafeParameterSets<R>(
  _ sets: [[UInt8]],
  _ body: (UnsafeBufferPointer<UnsafePointer<UInt8>>, UnsafeBufferPointer<Int>) -> R
) -> R {
  var pointers: [UnsafePointer<UInt8>] = []
  var sizes: [Int] = []
  var buffers: [UnsafeMutableBufferPointer<UInt8>] = []
  defer { for buffer in buffers { buffer.deallocate() } }

  for set in sets {
    let buffer = UnsafeMutableBufferPointer<UInt8>.allocate(capacity: set.count)
    _ = buffer.initialize(fromContentsOf: set)
    buffers.append(buffer)
    pointers.append(UnsafePointer(buffer.baseAddress!))
    sizes.append(set.count)
  }
  return pointers.withUnsafeBufferPointer { pointerBuffer in
    sizes.withUnsafeBufferPointer { sizeBuffer in
      body(pointerBuffer, sizeBuffer)
    }
  }
}
