import Foundation

/// The pairing payload a desktop shows as a QR code or short code.
public struct PairingPayload: Codable, Sendable {
  public var v: Int
  /// Public wss:// URL of the gateway.
  public var url: String
  /// Desktop static public key, base64url.
  public var ds_pub: String
  /// 32 bytes, base64url. Travels only in the QR — never over the wire, which
  /// is what stops a relay completing the handshake in either direction.
  public var pairing_secret: String
}

public struct PairingGrant: Codable, Sendable {
  public var device_id: String
  public var capabilities: [String]
  /// The computer's name, labelling it in the phone's paired list.
  public var host_name: String?
}

/// What the client tells the desktop it is, in the first handshake message.
///
/// The desktop's confirm screen names it and drops the grants a phone cannot
/// use. Unauthenticated by nature — it decides what is *offered*, never what is
/// allowed.
public struct PairingClientInfo: Codable, Sendable, Equatable {
  public var product: String
  /// `desktop`, `mobile` or `web`.
  public var kind: String
  /// What it runs on, for the human: "iPhone 17 Pro".
  public var device: String?
  public var version: String?

  public init(product: String, kind: String, device: String? = nil, version: String? = nil) {
    self.product = product
    self.kind = kind
    self.device = device
    self.version = version
  }
}

public enum PairingError: Error, Equatable {
  case invalidCode
  /// Wrong code, or a machine in the middle — indistinguishable by design.
  case handshakeFailed
  case unreadableGrant
  case cancelled
}

/// Client half of pairing: connects to the gateway's `/pair` endpoint, runs the
/// Noise IKpsk1 initiator handshake, surfaces the SAS, and receives the
/// encrypted grant the desktop sends once the user confirms.
public actor PairingClient {
  public enum Event: Sendable {
    /// The 6-digit short authentication string to compare with the desktop.
    case sas(String)
    case paired(DeviceIdentity)
    case failed(PairingError)
  }

  private let payload: PairingPayload
  private let keypair: NoiseKeypair
  private var socket: GatewaySocket?
  private var handshake: NoiseHandshake?
  private var session: NoiseSession?
  private var done = false
  private var continuation: AsyncStream<Event>.Continuation?
  private var pump: Task<Void, Never>?

  private let client: PairingClientInfo?

  public init(
    payload: PairingPayload,
    keypair: NoiseKeypair = NoiseCrypto.generateKeypair(),
    client: PairingClientInfo? = nil
  ) {
    self.payload = payload
    self.keypair = keypair
    self.client = client
  }

  /// Parse a scanned QR string or a pasted base64url pairing code.
  public static func parse(_ input: String) throws -> PairingPayload {
    let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
    let data: Data
    if trimmed.hasPrefix("{") {
      data = Data(trimmed.utf8)
    } else if let decoded = ArgusBase64.decodeURL(trimmed) {
      data = decoded
    } else {
      throw PairingError.invalidCode
    }
    guard let payload = try? JSONDecoder().decode(PairingPayload.self, from: data),
      payload.v == 1, !payload.url.isEmpty, !payload.ds_pub.isEmpty
    else { throw PairingError.invalidCode }
    return payload
  }

  public func start() -> AsyncStream<Event> {
    let (stream, continuation) = AsyncStream<Event>.makeStream()
    self.continuation = continuation
    guard let endpoint = URL(string: "\(payload.url)/pair") else {
      continuation.yield(.failed(.invalidCode))
      continuation.finish()
      return stream
    }
    let socket = GatewaySocket(url: endpoint)
    self.socket = socket
    pump = Task { [weak self] in
      guard let self else { return }
      for await event in await socket.connect() {
        await self.handle(event)
      }
    }
    return stream
  }

  public func cancel() async {
    done = true
    pump?.cancel()
    await socket?.close()
    continuation?.finish()
    continuation = nil
  }

  private func fail(_ error: PairingError) async {
    guard !done else { return }
    continuation?.yield(.failed(error))
    await cancel()
  }

  private func handle(_ event: GatewaySocket.Event) async {
    guard !done else { return }
    switch event {
    case .open:
      await beginHandshake()
    case .frame(let data):
      await onData(data)
    case .closed:
      break
    }
  }

  private func beginHandshake() async {
    guard let remote = ArgusBase64.decodeURL(payload.ds_pub),
      let secret = ArgusBase64.decodeURL(payload.pairing_secret)
    else {
      await fail(.invalidCode)
      return
    }
    do {
      let hs = try NoiseHandshake(
        NoiseHandshakeConfig(
          role: .initiator,
          staticKey: keypair,
          remoteStatic: remote,
          psk: ArgusDerive.pairingPSK(from: secret)
        ))
      handshake = hs
      await socket?.send(try hs.writeMessage(identityPayload()))
    } catch {
      await fail(.handshakeFailed)
    }
  }

  /// Our identity as handshake payload bytes; empty when we were not told.
  private func identityPayload() -> Data {
    guard let client, let encoded = try? JSONEncoder().encode(client) else {
      return Data()
    }
    return encoded
  }

  private func onData(_ bytes: Data) async {
    guard let hs = handshake else { return }

    if session == nil {
      do {
        _ = try hs.readMessage(bytes)
        session = try hs.session()
        continuation?.yield(.sas(ArgusDerive.sas(handshakeHash: try hs.handshakeHash())))
      } catch {
        await fail(.handshakeFailed)
      }
      return
    }

    guard let session,
      let plain = try? session.decrypt(bytes),
      let grant = try? JSONDecoder().decode(PairingGrant.self, from: plain),
      let remote = ArgusBase64.decodeURL(payload.ds_pub)
    else {
      await fail(.unreadableGrant)
      return
    }

    done = true
    let identity = DeviceIdentity(
      deviceId: grant.device_id,
      devPrivB64: ArgusBase64.encode(keypair.priv),
      devPubB64: ArgusBase64.encode(keypair.pub),
      // Re-encoded from base64url so everything downstream sees one form.
      desktopPubB64: ArgusBase64.encode(remote),
      url: payload.url,
      capabilities: grant.capabilities,
      hostName: grant.host_name,
      pairedAt: Date().timeIntervalSince1970 * 1000
    )
    continuation?.yield(.paired(identity))
    await socket?.close()
    continuation?.finish()
    continuation = nil
  }
}
