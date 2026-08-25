import AVFoundation
import ExpoModulesCore
import UIKit

/// Renders AVCC access units with AVSampleBufferDisplayLayer. The desktop
/// gateway already produces a decodable elementary stream, so this only has to
/// wrap each access unit in a CMSampleBuffer and enqueue it.
final class ArgusVideoView: ExpoView {
  private let displayLayer = AVSampleBufferDisplayLayer()
  private var formatDescription: CMFormatDescription?
  /// A layer restarted after a flush must resume on a keyframe.
  private var awaitingKeyFrame = true
  private var reportedFirstFrame = false

  let onFirstFrame = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    displayLayer.videoGravity = .resizeAspect
    displayLayer.backgroundColor = UIColor.black.cgColor
    layer.addSublayer(displayLayer)
    backgroundColor = .black
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    displayLayer.frame = bounds
  }

  func configure(codec: String, description: [UInt8]) throws {
    // The gateway only ever encodes H.264; anything else would decode to noise.
    guard codec.hasPrefix("avc") else {
      throw Exception(
        name: "ArgusVideoConfigError",
        description: "unsupported codec: \(codec)"
      )
    }
    guard let avcc = AvccDescription(description),
          let format = avcc.formatDescription()
    else {
      throw Exception(
        name: "ArgusVideoConfigError",
        description: "could not parse the stream's avcC description"
      )
    }
    formatDescription = format
    awaitingKeyFrame = true
    displayLayer.flush()
  }

  func enqueue(data: Data, isKeyFrame: Bool, timestamp: Double) throws {
    guard let format = formatDescription else {
      return
    }
    // VideoToolbox must (re)start on a keyframe; drop deltas until one arrives.
    if awaitingKeyFrame {
      if !isKeyFrame {
        return
      }
      awaitingKeyFrame = false
    }
    // A failed layer never recovers on its own — reset and wait for the next
    // keyframe rather than silently freezing on the last frame.
    if displayLayer.status == .failed {
      displayLayer.flush()
      awaitingKeyFrame = true

      return
    }

    var blockBuffer: CMBlockBuffer?
    var bytes = [UInt8](data)
    var status = CMBlockBufferCreateWithMemoryBlock(
      allocator: kCFAllocatorDefault,
      memoryBlock: nil,
      blockLength: bytes.count,
      blockAllocator: kCFAllocatorDefault,
      customBlockSource: nil,
      offsetToData: 0,
      dataLength: bytes.count,
      flags: 0,
      blockBufferOut: &blockBuffer
    )
    guard status == noErr, let block = blockBuffer else {
      return
    }
    status = CMBlockBufferReplaceDataBytes(
      with: &bytes,
      blockBuffer: block,
      offsetIntoDestination: 0,
      dataLength: bytes.count
    )
    guard status == noErr else {
      return
    }

    // Timestamps arrive in milliseconds from the desktop's capture clock.
    var timing = CMSampleTimingInfo(
      duration: .invalid,
      presentationTimeStamp: CMTime(value: CMTimeValue(timestamp * 1000), timescale: 1_000_000),
      decodeTimeStamp: .invalid
    )
    var sampleSize = bytes.count
    var sampleBuffer: CMSampleBuffer?
    status = CMSampleBufferCreateReady(
      allocator: kCFAllocatorDefault,
      dataBuffer: block,
      formatDescription: format,
      sampleCount: 1,
      sampleTimingEntryCount: 1,
      sampleTimingArray: &timing,
      sampleSizeEntryCount: 1,
      sampleSizeArray: &sampleSize,
      sampleBufferOut: &sampleBuffer
    )
    guard status == noErr, let sample = sampleBuffer else {
      return
    }

    if let attachments = CMSampleBufferGetSampleAttachmentsArray(
      sample,
      createIfNecessary: true
    ) as? [CFMutableDictionary], let first = attachments.first {
      CFDictionarySetValue(
        first,
        Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
        Unmanaged.passUnretained(kCFBooleanTrue).toOpaque()
      )
    }

    displayLayer.enqueue(sample)

    if !reportedFirstFrame {
      reportedFirstFrame = true
      onFirstFrame()
    }
  }
}
