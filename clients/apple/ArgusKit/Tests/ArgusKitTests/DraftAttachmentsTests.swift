import Foundation
import Testing
@testable import ArgusKit

@Suite("Composer draft attachments")
struct DraftAttachmentsTests {
  private let directory = FileManager.default.temporaryDirectory
    .appendingPathComponent("draft-attachments-\(UUID().uuidString)")

  @Test("An agent's images come back as they were saved, and only its own")
  func roundTrip() {
    let store = DraftAttachments(directory: directory)
    let images = [
      RemoteImageAttachment(data: "aGVsbG8=", mediaType: "image/png"),
      RemoteImageAttachment(data: "d29ybGQ=", mediaType: "image/jpeg"),
    ]
    store.save(images, agentId: "agent/1")
    #expect(store.load(agentId: "agent/1") == images)
    #expect(store.load(agentId: "agent-2").isEmpty)
    try? FileManager.default.removeItem(at: directory)
  }

  @Test("Saving none, or removing, clears the draft")
  func clears() {
    let store = DraftAttachments(directory: directory)
    let image = RemoteImageAttachment(data: "aGVsbG8=", mediaType: "image/png")
    store.save([image], agentId: "a")
    store.save([], agentId: "a")
    #expect(store.load(agentId: "a").isEmpty)
    store.save([image], agentId: "a")
    store.remove(agentId: "a")
    #expect(store.load(agentId: "a").isEmpty)
    try? FileManager.default.removeItem(at: directory)
  }
}
