#if DEBUG
  import ArgusCore
  import ArgusKit
  import ArgusUI
  import Foundation
  import SwiftUI

  /// Teammates: the list, the template gallery, a conversation and its pages —
  /// the same ids and fixtures as the Mac gallery's `TeammateStories`.
  enum TeammateStories {
    static var all: [GalleryStory] {
      let id = GalleryFixtures.ciFixerId
      return [
        GalleryStory("teammates/list", fixtures: fixtures, setup: refresh) { TeammatesView() },
        GalleryStory("teammates/list/empty", fixtures: GalleryFixtures.teammates(empty: true), setup: refresh) {
          TeammatesView()
        },
        GalleryStory("teammates/gallery", fixtures: fixtures) { TeammateGalleryView() },
        GalleryStory("teammates/chat", fixtures: chat, setup: refresh) {
          TeammateView(teammateId: id, threadId: nil)
        },
        GalleryStory("teammates/chat/monitor", fixtures: fixtures, setup: monitor) {
          TeammateView(teammateId: id, threadId: nil)
        },
        GalleryStory("teammates/profile", fixtures: fixtures) { TeammateProfileView(teammateId: id) },
        GalleryStory("teammates/duties", fixtures: fixtures, setup: loadRuns) { TeammateDutiesView(teammateId: id) },
        GalleryStory("teammates/memory", fixtures: fixtures) { TeammateMemoryView(teammateId: id) },
      ]
    }

    private static var fixtures: [String: String] { GalleryFixtures.teammates() }

    /// The conversation opens on the transcript fixture's agent.
    private static var chat: [String: String] {
      var merged = GalleryFixtures.teammates().merging(GalleryFixtures.transcript(.idle)) { _, new in new }
      let method = ArgusProtocol.Methods.TeammatesOpenThread.name
      if let data = merged[method]?.data(using: .utf8),
        var opened = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
      {
        opened["agent_id"] = GalleryFixtures.transcriptAgent
        if let json = try? JSONSerialization.data(withJSONObject: opened) {
          merged[method] = String(decoding: json, as: UTF8.self)
        }
      }
      return merged
    }

    @MainActor
    private static func refresh(_ stage: GalleryStage) async {
      await stage.teammates.refresh()
    }

    /// A device without control gets the conversation list.
    @MainActor
    private static func monitor(_ stage: GalleryStage) async {
      stage.host.capabilities = ["monitor"]
      await stage.teammates.refresh()
    }

    @MainActor
    private static func loadRuns(_ stage: GalleryStage) async {
      await stage.automations.refresh()
    }
  }
#endif
