import Foundation

/// Base64 helpers matching the client's tolerant decoder.
///
/// The pairing payload is base64**url** while the keystore holds standard
/// base64, and the TS decoder strips anything outside the alphabet — so it
/// accepts unpadded and lightly mangled input. Be lenient on read, strict on
/// write, or a pairing code pasted with a stray newline stops working.
public enum ArgusBase64 {
  public static func encode(_ data: Data) -> String {
    data.base64EncodedString()
  }

  public static func decode(_ string: String) -> Data? {
    let alphabet = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=")
    var cleaned = String(string.filter { alphabet.contains($0) })
    cleaned = cleaned.replacingOccurrences(of: "=", with: "")
    let padding = (4 - cleaned.count % 4) % 4
    // A remainder of 1 can never be valid base64, padded or not.
    if cleaned.count % 4 == 1 { return nil }
    return Data(base64Encoded: cleaned + String(repeating: "=", count: padding))
  }

  public static func encodeURL(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  public static func decodeURL(_ string: String) -> Data? {
    decode(
      string
        .replacingOccurrences(of: "-", with: "+")
        .replacingOccurrences(of: "_", with: "/")
    )
  }
}
