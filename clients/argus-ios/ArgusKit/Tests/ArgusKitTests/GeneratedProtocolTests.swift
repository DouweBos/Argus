import Foundation
import Testing

@testable import ArgusKit

/// The generated wire types have to round-trip what the host sends and
/// accepts, and tolerate what a newer host adds.
struct GeneratedProtocolTests {
  @Test func encodesCommandParamsWithWireKeys() throws {
    let params = ArgusProtocol.Commands.ReadFile.Params(id: "s1", relativePath: "a.txt")
    let json = try JSONSerialization.jsonObject(with: ProtocolCodec.encoder.encode(params))
    let object = try #require(json as? [String: String])
    #expect(object == ["id": "s1", "relativePath": "a.txt"])
    #expect(ArgusProtocol.Commands.ReadFile.name == "read_file")
  }

  @Test func omitsAbsentOptionalParams() throws {
    let data = try ProtocolCodec.encoder.encode(
      ArgusProtocol.Commands.ListHostDirectory.Params())
    #expect(String(decoding: data, as: UTF8.self) == "{}")
  }

  @Test func decodesResultsAndKeepsUnknownEnumValues() throws {
    let listing = try ProtocolCodec.decoder.decode(
      ArgusProtocol.HostDirectoryListing.self,
      from: Data(#"{"entries":[{"is_repo":true,"name":"a","path":"/a"}],"home":"/","parent":null,"path":"/"}"#.utf8))
    #expect(listing.entries.first?.isRepo == true)
    #expect(listing.parent == nil)

    let mode = try ProtocolCodec.decoder.decode(
      ArgusProtocol.RemotePermissionMode.self, from: Data(#""from_the_future""#.utf8))
    #expect(mode.rawValue == "from_the_future")
    #expect(ArgusProtocol.RemotePermissionMode.plan.rawValue == "plan")
  }
}
