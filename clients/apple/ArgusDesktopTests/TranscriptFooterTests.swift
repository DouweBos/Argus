import AppKit
import ArgusCore
import ArgusUI
import Foundation
import SwiftUI
import Testing

@testable import Argus

extension WindowDrivingTests {
  /// The foot of a new chat: the working indicator turns up after the row was
  /// measured without it, and must still get the whole height it needs.
  @MainActor
  @Suite(.serialized)
  struct TranscriptFooterTests {
    @Test(arguments: [0, 1, 40], [600, 40] as [CGFloat]) func workingIndicatorGetsItsHeight(promptParagraphs: Int, startHeight: CGFloat) async throws {
      let backend = StatusBackend()
      let store = HostStore()
      await store.attach(backend)
      backend.status(.idle)
      let hosting = NSHostingView(
        rootView: AnyView(
          TranscriptView(agentKey: StatusBackend.agent, sessionId: "s", showsEmptyState: false)
            .environment(store).environment(ImageViewerState())))
      let window = NSWindow(
        contentRect: NSRect(x: -6000, y: -6000, width: 900, height: startHeight), styleMask: [.borderless],
        backing: .buffered, defer: false)
      window.contentView = hosting
      window.orderFrontRegardless()
      // Gone for good, not just hidden: a live table and store would keep
      // competing for the main run loop with the suites after this one.
      defer {
        window.orderOut(nil)
        window.contentView = nil
        Task { await store.detach() }
      }
      try await settle(window, passes: 50)

      if promptParagraphs > 0 {
        let prompt = Array(repeating: "Compare the two forks and list what each changes.", count: promptParagraphs)
        Task { await store.sendMessage(agentId: StatusBackend.agent, message: prompt.joined(separator: "\n\n")) }
        pass(window)
        try await settle(window, passes: 5)
      }
      // The start composer leaves the middle of the pane, which hands the transcript its height.
      window.setContentSize(NSSize(width: 900, height: 600))
      backend.status(.running)
      try await settle(window, passes: 30)

      let scrollView = try #require(scrollViews(in: hosting).first { $0 is TranscriptScrollView })
      let table = try #require(scrollView.documentView as? NSTableView)
      let footer = table.numberOfRows - 1
      let cell = try #require(table.view(atColumn: 0, row: footer, makeIfNecessary: false) as? TranscriptCell)
      let content = try #require(cell.laidOutHeight)
      let rect = table.rect(ofRow: footer)
      // Taller than the 16 points of padding it has without the indicator.
      #expect(content > 30)
      #expect(abs(rect.height - ceil(content)) <= 1, "footer \(rect.height) for \(content) of content")
      #expect(rect.maxY <= scrollView.contentView.bounds.maxY + 0.5, "footer below the fold")
      if promptParagraphs == 0 { #expect(scrollView.contentView.bounds.minY <= 0.5) }
      if promptParagraphs > 0 {
        #expect(table.numberOfRows == 3)
        // The prompt's bubble sits right above the indicator, as tall as it draws.
        let bubble = table.rect(ofRow: 1)
        #expect(bubble.maxY > scrollView.contentView.bounds.minY, "prompt scrolled out of view")
        if let cell = table.view(atColumn: 0, row: 1, makeIfNecessary: false) as? TranscriptCell,
          let drawn = cell.laidOutHeight
        {
          #expect(abs(bubble.height - ceil(drawn)) <= 1, "prompt \(bubble.height) for \(drawn) of content")
        }
      }
    }

    private func scrollViews(in view: NSView) -> [NSScrollView] {
      ((view as? NSScrollView).map { [$0] } ?? []) + view.subviews.flatMap(scrollViews)
    }

    private func settle(_ window: NSWindow, passes: Int) async throws {
      for _ in 0..<passes {
        pass(window)
        try await Task.sleep(for: .milliseconds(20))
      }
    }

    private func pass(_ window: NSWindow) {
      window.contentView?.layoutSubtreeIfNeeded()
      window.displayIfNeeded()
      RunLoop.main.run(until: Date())
    }
  }
}

/// A host whose agent has an empty chat and a status pushed as events.
private final class StatusBackend: HostBackend, @unchecked Sendable {
  struct Unavailable: Error {}
  static let agent = "fresh"

  let kind = HostBackendKind.gateway
  private var seq = 0
  private let stream: AsyncStream<HostEvent>
  private let continuation: AsyncStream<HostEvent>.Continuation

  init() {
    (stream, continuation) = AsyncStream<HostEvent>.makeStream()
  }

  func status(_ state: RemoteAgentState) {
    seq += 1
    let frame =
      #"{"seq":\#(seq),"event":"agent.status","agent_id":"\#(Self.agent)","#
      + #""payload":{"agent_id":"\#(Self.agent)","session_id":"s","status":"\#(state.rawValue)"}}"#
    continuation.yield(.event(try! ProtocolCodec.decoder.decode(EventEnvelope.self, from: Data(frame.utf8))))
  }

  func events() async -> AsyncStream<HostEvent> { stream }

  func request<Params: Encodable & Sendable, Result: Decodable & Sendable>(
    _ method: RemoteMethod, _ params: Params, as: Result.Type
  ) async throws -> Result {
    switch method {
    case .agentsTranscript:
      let page = RemoteTranscript(
        messages: [], nextAfter: nil, prevBefore: nil, total: 0, tasks: nil, todos: nil,
        model: nil, pendingToolName: nil, epoch: "e", revision: 0)
      return try ProtocolCodec.decoder.decode(Result.self, from: ProtocolCodec.encoder.encode(page))
    case .agentsSend:
      return try ProtocolCodec.decoder.decode(Result.self, from: Data(#"{"queued":false}"#.utf8))
    default:
      throw Unavailable()
    }
  }

  func request<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) async throws -> C.Result {
    throw Unavailable()
  }

  func subscribe(agentId: String, on: Bool) async {}

  func disconnect() async { continuation.finish() }
}
