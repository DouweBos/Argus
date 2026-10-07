import AppKit
import ArgusCore
import ArgusUI
import Foundation
import QuartzCore
import SwiftUI
import Testing

@testable import Argus

/// A long saved chat, decoded, reduced and laid out the way the Mac shows a
/// resumed agent, then resized like a sidebar drag. Opt-in: point
/// `ARGUS_TRANSCRIPT_PERF` (via `TEST_RUNNER_ARGUS_TRANSCRIPT_PERF`) at a saved
/// conversation JSON; timings go to stdout and `<file>.perf.json`.
@MainActor
@Suite(.serialized, .enabled(if: ProcessInfo.processInfo.environment["ARGUS_TRANSCRIPT_PERF"] != nil))
struct TranscriptPerfTests {
  private var path: String { ProcessInfo.processInfo.environment["ARGUS_TRANSCRIPT_PERF"] ?? "" }

  @Test func longSavedChat() async throws {
    var report: [String: Any] = [:]
    let data = try Data(contentsOf: URL(fileURLWithPath: path))

    var start = CACurrentMediaTime()
    let saved = try JSONDecoder().decode(ArgusProtocol.SavedConversation.self, from: data)
    report["decode_saved_ms"] = ms(since: start)

    start = CACurrentMediaTime()
    let source = LiveAgents.messages(of: saved)
    report["to_conversation_ms"] = ms(since: start)

    start = CACurrentMediaTime()
    var reducer = ConversationReducer(conversation: nil, environment: .live)
    reducer.loadSavedMessages(source, model: saved.model, sessionId: saved.sessionId, resuming: true)
    report["reduce_ms"] = ms(since: start)

    start = CACurrentMediaTime()
    let messages = try RemoteTranscriptBuilder.messages(try #require(reducer.conversation))
    report["project_rows_ms"] = ms(since: start)
    report["messages"] = messages.count

    // What `LiveAgents.project` does per event: every row checked against its cached source.
    let copy = reducer.conversation?.messages ?? []
    start = CACurrentMediaTime()
    let unchanged = zip(source, copy).allSatisfy { $0 == $1 }
    report["project_cache_check_ms"] = ms(since: start)
    #expect(unchanged)

    // What every debounced save of a live agent encodes: the snapshot, then
    // the history's messages through `[JSONValue]`, then that request.
    let conversation = try #require(reducer.conversation)
    start = CACurrentMediaTime()
    _ = try JSONEncoder().encode(conversation)
    report["save_snapshot_ms"] = ms(since: start)
    start = CACurrentMediaTime()
    let history = try JSONDecoder().decode([JSONValue].self, from: JSONEncoder().encode(conversation.messages))
    _ = try JSONEncoder().encode(history)
    report["save_history_ms"] = ms(since: start)

    let store = HostStore()
    let hosting = NSHostingView(rootView: Self.root(messages, store: store))
    let window = NSWindow(
      contentRect: NSRect(x: -6000, y: -6000, width: 900, height: 800), styleMask: [.borderless],
      backing: .buffered, defer: false)
    window.contentView = hosting
    window.orderFrontRegardless()
    defer { window.orderOut(nil) }

    start = CACurrentMediaTime()
    pass(window)
    report["first_layout_ms"] = ms(since: start)
    // Let the landing scroll and lazy measuring settle before the drag.
    for _ in 0..<20 {
      pass(window)
      try await Task.sleep(for: .milliseconds(20))
    }

    let scrollView = try #require(Self.scrollViews(in: hosting).max {
      ($0.documentView?.frame.height ?? 0) < ($1.documentView?.frame.height ?? 0)
    })
    report["settled_at"] = Self.position(scrollView)
    report["resize_at_tail"] = drag(window)

    report["after_drag_at"] = Self.position(scrollView)

    // Read back through the whole history, the way the reader who hit the freeze had.
    // Trackpad gestures, so the view sees the reader leave the tail.
    var scrollSteps: [Double] = []
    var stalled = 0
    Self.wheel(scrollView, phase: .began, delta: 0)
    while stalled < 10, scrollSteps.count < 3000 {
      let before = scrollView.contentView.bounds.origin.y
      start = CACurrentMediaTime()
      Self.wheel(scrollView, phase: .changed, delta: 600)
      let clip = scrollView.contentView
      if clip.bounds.origin.y == before {
        clip.scroll(to: NSPoint(x: 0, y: max(0, before - 600)))
        scrollView.reflectScrolledClipView(clip)
      }
      pass(window)
      scrollSteps.append(ms(since: start))
      // Older rows are revealed from a main-actor task; let it run.
      try await Task.sleep(for: .milliseconds(20))
      stalled = scrollView.contentView.bounds.origin.y == before ? stalled + 1 : 0
    }
    Self.wheel(scrollView, phase: .ended, delta: 0)
    try await Task.sleep(for: .milliseconds(100))
    report["top_at"] = Self.position(scrollView)
    report["scroll_to_top"] = Self.stats(scrollSteps)
    report["content_height_at_top"] = scrollView.documentView?.frame.height ?? 0
    report["resize_at_top"] = drag(window)
    report["after_top_drag_at"] = Self.position(scrollView)

    // Streamed text growing the last message, back at the tail.
    let clip = scrollView.contentView
    let flipped = scrollView.documentView?.isFlipped ?? true
    clip.scroll(to: NSPoint(x: 0, y: flipped ? (scrollView.documentView?.frame.height ?? 0) : 0))
    scrollView.reflectScrolledClipView(clip)
    for _ in 0..<10 {
      pass(window)
      try await Task.sleep(for: .milliseconds(20))
    }
    var updates: [Double] = []
    var streamed = messages
    for index in 0..<30 {
      streamed[streamed.count - 1].textBlocks.append("token \(index) ")
      start = CACurrentMediaTime()
      hosting.rootView = Self.root(streamed, store: store)
      pass(window)
      updates.append(ms(since: start))
    }
    report["stream_update"] = Self.stats(updates)

    let json = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
    try json.write(to: URL(fileURLWithPath: path + ".perf.json"))
    print("[transcript-perf] \(String(decoding: json, as: UTF8.self))")
    #expect(messages.count > 0)
  }

  private static let viewer = ImageViewerState()

  private static func root(_ messages: [RemoteMessage], store: HostStore) -> some View {
    TranscriptView(agentKey: "perf", sessionId: "perf", fixture: messages)
      .environment(store)
      .environment(viewer)
  }

  /// A sidebar drag: 900pt down to 560pt and back in 10pt steps.
  private func drag(_ window: NSWindow) -> [String: Double] {
    let widths = Array(stride(from: 890, through: 560, by: -10)) + Array(stride(from: 570, through: 900, by: 10))
    var steps: [Double] = []
    for width in widths {
      let start = CACurrentMediaTime()
      window.setContentSize(NSSize(width: CGFloat(width), height: 800))
      pass(window)
      steps.append(ms(since: start))
    }
    return Self.stats(steps)
  }

  private static func stats(_ steps: [Double]) -> [String: Double] {
    let sorted = steps.sorted()
    guard !sorted.isEmpty else { return [:] }
    return [
      "steps": Double(steps.count),
      "total_ms": (steps.reduce(0, +) * 10).rounded() / 10,
      "p50_ms": sorted[sorted.count / 2],
      "p95_ms": sorted[min(sorted.count - 1, Int(Double(sorted.count) * 0.95))],
      "max_ms": sorted.last ?? 0,
    ]
  }

  /// A precise (trackpad) scroll-wheel event; positive `delta` scrolls toward the top.
  private static func wheel(_ scrollView: NSScrollView, phase: NSEvent.Phase, delta: Int32) {
    guard
      let cg = CGEvent(
        scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: delta, wheel2: 0, wheel3: 0)
    else { return }
    cg.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
    cg.setIntegerValueField(.scrollWheelEventScrollPhase, value: Int64(phase.rawValue))
    if let window = scrollView.window {
      let frame = window.frame
      let screenHeight = NSScreen.screens.first?.frame.height ?? 0
      cg.location = CGPoint(x: frame.midX, y: screenHeight - frame.midY)
    }
    if let event = NSEvent(cgEvent: cg) { scrollView.window?.sendEvent(event) }
  }

  private static func position(_ scrollView: NSScrollView) -> [String: Double] {
    ["offset": Double(scrollView.contentView.bounds.origin.y), "content": Double(scrollView.documentView?.frame.height ?? 0)]
  }

  private static func scrollViews(in view: NSView) -> [NSScrollView] {
    ((view as? NSScrollView).map { [$0] } ?? []) + view.subviews.flatMap(scrollViews)
  }

  /// One main-thread pass: layout, draw, then whatever SwiftUI deferred.
  private func pass(_ window: NSWindow, wait: TimeInterval = 0) {
    window.contentView?.layoutSubtreeIfNeeded()
    window.displayIfNeeded()
    RunLoop.main.run(until: Date(timeIntervalSinceNow: wait))
    window.contentView?.layoutSubtreeIfNeeded()
    window.displayIfNeeded()
  }

  private func ms(since start: CFTimeInterval) -> Double {
    ((CACurrentMediaTime() - start) * 10_000).rounded() / 10
  }
}
