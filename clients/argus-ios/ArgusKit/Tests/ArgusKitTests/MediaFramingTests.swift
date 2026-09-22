import Foundation
import Testing
@testable import ArgusKit

/// Frames built by the host's own `buildConfigBody` / `buildFrameBody`
/// (`packages/host/src/services/remote/gateway.ts`). Every multi-byte field is
/// little-endian including the Float64 timestamp, which is exactly the sort of
/// thing a port gets silently wrong.
@Suite("Media framing")
struct MediaFramingTests {
  private static let configFrame =
    "AAABEAAAAAAAAAAAkgTkCQthdmMxLjY0MDAyOAFkACj/4QAFZ2QAKAEBAARo7jyw"
  private static let configDescription = "AWQAKP/hAAVnZAAoAQEABGjuPLA="
  private static let keyFrame = "AQEBEK36XG1FSpNAAAAABWUBAgME"
  private static let deltaFrame = "AQD//wAAAOiH1mJBAAAAAkEJ"

  @Test("parses a config message")
  func config() throws {
    let parsed = MediaMessage.parse(ArgusBase64.decode(Self.configFrame)!)
    guard case .config(let streamId, let codec, let w, let h, let description) = parsed else {
      Issue.record("expected a config message, got \(String(describing: parsed))")
      return
    }
    #expect(streamId == 4097)
    #expect(codec == "avc1.640028")
    #expect(w == 1170)
    #expect(h == 2532)
    #expect(ArgusBase64.encode(description) == Self.configDescription)
  }

  @Test("parses a key frame, little-endian timestamp and all")
  func keyFrame() throws {
    let parsed = MediaMessage.parse(ArgusBase64.decode(Self.keyFrame)!)
    guard case .frame(let streamId, let isKey, let timestamp, let data) = parsed else {
      Issue.record("expected a frame")
      return
    }
    #expect(streamId == 4097)
    #expect(isKey)
    #expect(abs(timestamp - 1234.5678) < 0.0001)
    #expect([UInt8](data) == [0, 0, 0, 5, 101, 1, 2, 3, 4])
  }

  @Test("parses a delta frame at the top of the stream-id range")
  func deltaFrame() throws {
    let parsed = MediaMessage.parse(ArgusBase64.decode(Self.deltaFrame)!)
    guard case .frame(let streamId, let isKey, let timestamp, let data) = parsed else {
      Issue.record("expected a frame")
      return
    }
    // Stream ids wrap at 0xffff, so the boundary value has to survive.
    #expect(streamId == 65535)
    #expect(!isKey)
    #expect(abs(timestamp - 9_876_543.25) < 0.0001)
    #expect([UInt8](data) == [0, 0, 0, 2, 65, 9])
  }

  @Test("rejects truncated and unmodelled messages")
  func rejects() {
    #expect(MediaMessage.parse(Data([0, 0, 0, 0])) == nil)
    #expect(MediaMessage.parse(Data()) == nil)
    // msgType 2 is the desktop's JPEG browser stream — not ours to decode.
    var jpeg = Data(repeating: 0, count: 16)
    jpeg[0] = 2
    #expect(MediaMessage.parse(jpeg) == nil)
  }
}

@Suite("Base64 tolerance")
struct Base64Tests {
  @Test("round-trips standard base64")
  func roundTrip() {
    let data = Data([0, 1, 2, 250, 251, 255])
    #expect(ArgusBase64.decode(ArgusBase64.encode(data)) == data)
  }

  @Test("accepts unpadded and whitespace-mangled input")
  func lenient() {
    let data = Data([1, 2, 3, 4, 5])
    let padded = ArgusBase64.encode(data)
    let unpadded = padded.replacingOccurrences(of: "=", with: "")
    #expect(ArgusBase64.decode(unpadded) == data)
    #expect(ArgusBase64.decode("  \(padded)\n") == data)
  }

  @Test("translates base64url, which is how a pairing code arrives")
  func urlAlphabet() {
    let data = Data([0xfb, 0xff, 0xbe, 0x3e])
    let url = ArgusBase64.encodeURL(data)
    #expect(!url.contains("+") && !url.contains("/") && !url.contains("="))
    #expect(ArgusBase64.decodeURL(url) == data)
  }
}

/// The avcC record VideoToolbox is configured from. Its parameter-set lengths
/// are big-endian, unlike every field in the transport header around it, so
/// this is a natural place to get the byte order backwards.
@Suite("avcC description")
struct AvccDescriptionTests {
  /// The description carried by the real config frame in the fixtures above.
  private static let description = "AWQAKP/hAAVnZAAoAQEABGjuPLA="

  @Test("parses parameter sets and the NAL length size")
  func parses() throws {
    let parsed = try #require(AvccDescription.parse(ArgusBase64.decode(Self.description)!))
    #expect(parsed.nalUnitLengthSize == 4)
    // One SPS and one PPS, in that order.
    #expect(parsed.parameterSets.count == 2)
    #expect(parsed.parameterSets[0] == [0x67, 0x64, 0x00, 0x28, 0x01])
    #expect(parsed.parameterSets[1] == [0x68, 0xEE, 0x3C, 0xB0])
  }

  @Test("rejects a record it can't trust")
  func rejects() {
    #expect(AvccDescription.parse(Data()) == nil)
    // Version byte must be 1.
    #expect(AvccDescription.parse(Data([2, 0, 0, 0, 0xFF, 0xE1, 0, 0])) == nil)
    // Truncated mid parameter set.
    #expect(AvccDescription.parse(Data([1, 0x64, 0, 0x28, 0xFF, 0xE1, 0, 0x05, 0x67])) == nil)
  }
}
