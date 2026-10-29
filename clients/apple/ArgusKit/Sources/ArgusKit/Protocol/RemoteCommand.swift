import Foundation

/// A request the host serves, with its params and result types — generated
/// from the host's zod catalog into `ArgusProtocol.Commands` (raw commands,
/// admin tier) and `ArgusProtocol.Methods` (the typed remote methods).
public protocol RemoteCommand: SendableMetatype {
  associatedtype Params: Encodable & Sendable
  associatedtype Result: Decodable & Sendable
  /// The name on the wire: `read_file`, `agents.spawn`, …
  static var name: String { get }
  /// The catalog's capability tier: `monitor`, `control`, `admin` or `host`.
  static var tier: String { get }
}

extension RemoteCommand {
  /// The typed methods carry no tier of their own; none is above `control`.
  public static var tier: String { "control" }
}
