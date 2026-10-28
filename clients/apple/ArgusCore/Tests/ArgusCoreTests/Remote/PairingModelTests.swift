import ArgusCore
import Foundation
import Testing

@MainActor
struct PairingModelTests {
  @Test func walksFromStartToPairedAndReportsEachStage() async throws {
    let backend = FakeBackend()
    backend.reply(command: "remote_start_pairing", #"{"qrPayload":"qr","pairingCode":"code"}"#)
    backend.reply(command: "remote_confirm_pairing", "null")
    let model = PairingModel(backend: { backend })
    var stages: [String] = []
    model.onStage = { stage, client, grants in stages.append("\(stage.rawValue):\(client):\(grants.control)") }
    var paired = false
    model.onPaired = { paired = true }

    await model.start()
    #expect(model.presented)
    #expect(model.flow.phase == .waitingForDevice(qrPayload: "qr", pairingCode: "code"))

    model.handle(channel: "remote:pairing-sas", payload: try json(#"{"sas":"123456","client":{"product":"Argus","kind":"ios"}}"#))
    #expect(!model.flow.offersAdmin)
    model.flow.grantControl = true
    await model.confirm()
    if case .confirmingSent = model.flow.phase {} else { Issue.record("expected confirmingSent") }

    model.handle(channel: "remote:pairing-complete", payload: try json(#"{"device":{"label":"iPhone"}}"#))
    #expect(model.flow.phase == .paired(label: "iPhone"))
    #expect(paired)
    #expect(stages == ["started:unknown:false", "confirmed:ios:true", "completed:ios:true"])
  }

  @Test func closingOnTheCodeIsARejection() async throws {
    let backend = FakeBackend()
    backend.reply(command: "remote_start_pairing", #"{"qrPayload":"qr","pairingCode":"code"}"#)
    let model = PairingModel(backend: { backend })
    var stages: [PairingModel.Stage] = []
    model.onStage = { stage, _, _ in stages.append(stage) }
    await model.start()
    model.handle(channel: "remote:pairing-sas", payload: try json(#"{"sas":"123456"}"#))
    model.close()
    #expect(stages == [.started, .rejected])
    #expect(model.flow.phase == .idle)
    #expect(!model.presented)
    #expect(await eventually { backend.requested.contains("remote_cancel_pairing") })
  }

  @Test func ignoresOtherChannels() throws {
    let model = PairingModel(backend: { nil })
    #expect(!model.handle(channel: "remote:status", payload: .null))
  }
}

private func json(_ text: String) throws -> JSONValue {
  try ProtocolCodec.decoder.decode(JSONValue.self, from: Data(text.utf8))
}
