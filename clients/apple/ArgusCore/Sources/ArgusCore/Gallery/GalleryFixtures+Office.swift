import Foundation

/// A Word document for the QuickLook preview, zipped here so no binary fixture is checked in.
extension GalleryFixtures {
  public static func previewDocx() -> Data {
    let paragraphs = [
      ("Quick Open — rollout plan", true),
      ("Owner: Maya Chen · Reviewed by Ravi Patel", false),
      ("Goals", true),
      ("Open any file in the worktree in two keystrokes, on the Mac and both phones.", false),
      ("Milestones", true),
      ("1. Matcher and ranking land behind ⌘P.", false),
      ("2. The phones get Quick Open once files.read ships on the gateway.", false),
      ("3. Remember the last query per session.", false),
    ]
    let body = paragraphs.map { text, heading in
      let run = heading ? "<w:rPr><w:b/><w:sz w:val=\"32\"/></w:rPr>" : ""
      return "<w:p><w:r>\(run)<w:t xml:space=\"preserve\">\(text)</w:t></w:r></w:p>"
    }.joined()
    return storedZip([
      (
        "[Content_Types].xml",
        """
        <?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\
        <Default Extension="xml" ContentType="application/xml"/>\
        <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>
        """
      ),
      (
        "_rels/.rels",
        """
        <?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>
        """
      ),
      (
        "word/document.xml",
        """
        <?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\
        <w:body>\(body)</w:body></w:document>
        """
      ),
    ])
  }

  /// Uncompressed entries: enough for any zip reader.
  static func storedZip(_ files: [(String, String)]) -> Data {
    var out = Data()
    var central = Data()
    func le16(_ v: Int) -> Data { withUnsafeBytes(of: UInt16(v).littleEndian) { Data($0) } }
    func le32(_ v: UInt32) -> Data { withUnsafeBytes(of: v.littleEndian) { Data($0) } }
    for (name, text) in files {
      let bytes = Data(text.utf8)
      let nameBytes = Data(name.utf8)
      let crc = crc32(bytes)
      let offset = UInt32(out.count)
      out += le32(0x0403_4B50) + le16(20) + le16(0) + le16(0) + le16(0) + le16(0) + le32(crc)
      out += le32(UInt32(bytes.count)) + le32(UInt32(bytes.count)) + le16(nameBytes.count) + le16(0) + nameBytes + bytes
      central += le32(0x0201_4B50) + le16(20) + le16(20) + le16(0) + le16(0) + le16(0) + le16(0) + le32(crc)
      central += le32(UInt32(bytes.count)) + le32(UInt32(bytes.count)) + le16(nameBytes.count) + le16(0) + le16(0)
      central += le16(0) + le16(0) + le32(0) + le32(offset) + nameBytes
    }
    let start = UInt32(out.count)
    out += central
    out += le32(0x0605_4B50) + le16(0) + le16(0) + le16(files.count) + le16(files.count)
    out += le32(UInt32(central.count)) + le32(start) + le16(0)
    return out
  }

  private static func crc32(_ data: Data) -> UInt32 {
    var crc: UInt32 = 0xFFFF_FFFF
    for byte in data {
      crc ^= UInt32(byte)
      for _ in 0..<8 { crc = (crc >> 1) ^ (crc & 1 == 1 ? 0xEDB8_8320 : 0) }
    }
    return ~crc
  }
}
