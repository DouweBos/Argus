import AppKit
import ArgusCore
import ArgusUI
import Foundation
import QuartzCore
import SwiftUI
import Testing

@testable import Argus

/// A long chat laid out the way the Mac shows an agent.
///
/// `scrollThroughHistory` always runs: a synthetic 3000-message chat paged in
/// from a stand-in host, read from the newest message to the very first, then
/// resized while deep in history. It fails on a main-thread stall or if the
/// top is never reached — the long-chat freeze this table replaced.
///
/// `longChat` is opt-in, two paths, timings to stdout and `<file>.perf.json`:
///
/// - `ARGUS_TRANSCRIPT_PAGE` (via `TEST_RUNNER_…`): an `agents.transcript`
///   tail page, opened through the store the way the app opens an agent, then
///   streamed into with `agent.transcript` deltas.
/// - `ARGUS_TRANSCRIPT_PERF`: a saved conversation. The rows the app used to
///   fold from it are gone with the reducer, so the whole chat is the page's
///   rows repeated to the saved count — what holding every row costs.
@MainActor
@Suite(.serialized)
struct TranscriptPerfTests {
  private var pagePath: String { ProcessInfo.processInfo.environment["ARGUS_TRANSCRIPT_PAGE"] ?? "" }
  private var savedPath: String? { ProcessInfo.processInfo.environment["ARGUS_TRANSCRIPT_PERF"] }

  @Test(.timeLimit(.minutes(2))) func scrollThroughHistory() async throws {
    let fixture = TranscriptFixture.messages(count: 3000)
    let messages = TranscriptFixture.remote(fixture)
    let store = HostStore()
    await store.attach(FixtureBackend(messages: messages, images: [:]))
    let key = HostStore.stoppedKey(repoRoot: "/fixture", historyId: "perf")
    let (window, hosting) = Self.window(
      TranscriptView(agentKey: key, sessionId: "perf").environment(store).environment(Self.viewer))
    defer { window.orderOut(nil) }
    var start = CACurrentMediaTime()
    pass(window)
    let firstLayout = ms(since: start)
    try await settle(window)
    let scrollView = try #require(Self.scrollViews(in: hosting).first { $0 is TranscriptScrollView })

    // Wheel-sized steps up, as long as there is anything above: the table
    // measures rows as they come near and pages older history in on the way.
    var steps: [Double] = []
    var stalled = 0
    while stalled < 40, steps.count < 5000 {
      let clip = scrollView.contentView
      let before = clip.bounds.origin.y
      start = CACurrentMediaTime()
      clip.scroll(to: NSPoint(x: 0, y: max(0, before - 120)))
      scrollView.reflectScrolledClipView(clip)
      pass(window)
      steps.append(ms(since: start))
      // Suspend, so main-actor work the scroll started (paging older history in) runs.
      try await Task.sleep(for: .milliseconds(2))
      let atTop = clip.bounds.origin.y <= 0.5 && !store.hasOlderMessages(for: key)
      stalled = atTop ? stalled + 1 : 0
    }
    let loaded = store.messagesByAgent[key]?.count ?? 0
    let resize = drag(window)
    let report: [String: Any] = [
      "first_layout_ms": firstLayout, "scroll": Self.stats(steps), "resize_in_history": resize,
      "loaded": loaded, "content_height": scrollView.documentView?.frame.height ?? 0,
    ]
    let json = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
    print("[transcript-scroll-perf] \(String(decoding: json, as: UTF8.self))")

    #expect(loaded == messages.count, "reached the first message")
    #expect(scrollView.contentView.bounds.origin.y <= 0.5)
    // A frame's budget with room for a loaded CI machine; the freeze this
    // guards against never came back at all.
    #expect((Self.stats(steps)["max_ms"] ?? .infinity) < 150)
    #expect((Self.stats(steps)["p95_ms"] ?? .infinity) < 33)
    #expect((resize["max_ms"] ?? .infinity) < 150)
  }

  @Test(.enabled(if: ProcessInfo.processInfo.environment["ARGUS_TRANSCRIPT_PAGE"] != nil))
  func longChat() async throws {
    var report: [String: Any] = [:]
    let pageData = try Data(contentsOf: URL(fileURLWithPath: pagePath))
    report["page"] = try await openViaPage(pageData)

    if let savedPath {
      let data = try Data(contentsOf: URL(fileURLWithPath: savedPath))
      var start = CACurrentMediaTime()
      let saved = try JSONDecoder().decode(ArgusProtocol.SavedConversation.self, from: data)
      report["decode_saved_ms"] = ms(since: start)
      let page = try ProtocolCodec.decoder.decode(RemoteTranscript.self, from: pageData)
      start = CACurrentMediaTime()
      let messages = Self.tiled(page.messages, to: saved.messages.count)
      report["tile_rows_ms"] = ms(since: start)
      report["messages"] = messages.count
      report["full"] = try await fullChat(messages)
    }

    let out = (savedPath ?? pagePath) + ".perf.json"
    let json = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
    try json.write(to: URL(fileURLWithPath: out))
    print("[transcript-perf] \(String(decoding: json, as: UTF8.self))")
  }

  /// The viewer path: fetch and merge the tail page, lay it out, drag, then
  /// apply streamed deltas to its last message.
  private func openViaPage(_ data: Data) async throws -> [String: Any] {
    var report: [String: Any] = [:]
    let backend = PageBackend(page: data)
    let store = HostStore()
    await store.attach(backend)

    var start = CACurrentMediaTime()
    await store.loadTranscript(agentId: Self.agent)
    report["open_page_ms"] = ms(since: start)
    let messages = store.messagesByAgent[Self.agent] ?? []
    report["messages"] = messages.count
    #expect(messages.count > 0)

    let (window, hosting) = Self.window(Self.root(nil, store: store))
    defer { window.orderOut(nil) }
    start = CACurrentMediaTime()
    pass(window)
    report["first_layout_ms"] = ms(since: start)
    try await settle(window)
    report["resize_at_tail"] = drag(window)
    _ = hosting

    let page = try ProtocolCodec.decoder.decode(RemoteTranscript.self, from: data)
    var last = try #require(messages.last)
    var revision = page.revision ?? 0
    var updates: [Double] = []
    for index in 0..<30 {
      last.textBlocks.append("token \(index) ")
      revision += 1
      let frame = try Self.deltaFrame(last, epoch: page.epoch ?? "", revision: revision, total: page.total ?? 0)
      start = CACurrentMediaTime()
      backend.push(try ProtocolCodec.decoder.decode(EventEnvelope.self, from: frame))
      while store.messagesByAgent[Self.agent]?.last != last { await Task.yield() }
      pass(window)
      updates.append(ms(since: start))
    }
    report["stream_update"] = Self.stats(updates)
    return report
  }

  /// The whole chat held as rows: what opening it used to lay out.
  private func fullChat(_ messages: [RemoteMessage]) async throws -> [String: Any] {
    var report: [String: Any] = [:]
    let store = HostStore()
    let (window, hosting) = Self.window(Self.root(messages, store: store))
    defer { window.orderOut(nil) }

    var start = CACurrentMediaTime()
    pass(window)
    report["first_layout_ms"] = ms(since: start)
    try await settle(window)

    let scrollView = try #require(Self.scrollViews(in: hosting).max {
      ($0.documentView?.frame.height ?? 0) < ($1.documentView?.frame.height ?? 0)
    })
    report["settled_at"] = Self.position(scrollView)
    report["resize_at_tail"] = drag(window)
    report["after_drag_at"] = Self.position(scrollView)

    // Read back through the whole history with trackpad gestures, so the view
    // sees the reader leave the tail.
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

    // Streamed text growing the last message, back at the tail.
    let clip = scrollView.contentView
    let flipped = scrollView.documentView?.isFlipped ?? true
    clip.scroll(to: NSPoint(x: 0, y: flipped ? (scrollView.documentView?.frame.height ?? 0) : 0))
    scrollView.reflectScrolledClipView(clip)
    try await settle(window, passes: 10)
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
    return report
  }

  private static let agent = "perf"

  /// The page's rows repeated with fresh ids up to `count`.
  private static func tiled(_ rows: [RemoteMessage], to count: Int) -> [RemoteMessage] {
    guard !rows.isEmpty else { return [] }
    return (0..<count).map { index in
      var row = rows[(rows.count - count % rows.count + index) % rows.count]
      row.id = "\(row.id)-\(index)"
      return row
    }
  }

  /// An `agent.transcript` frame upserting one message.
  private static func deltaFrame(
    _ message: RemoteMessage, epoch: String, revision: Int, total: Int
  ) throws -> Data {
    let encoded = try ProtocolCodec.encoder.encode(message)
    let payload =
      #"{"agent_id":"\#(agent)","epoch":"\#(epoch)","revision":\#(revision),"total":\#(total),"#
      + #""messages":["# + String(decoding: encoded, as: UTF8.self)
      + #"],"removed_ids":[],"title":null,"model":null,"pending_tool_name":null,"tasks":null,"todos":null}"#
    return Data(#"{"seq":\#(revision),"event":"agent.transcript","agent_id":"\#(agent)","payload":\#(payload)}"#.utf8)
  }

  private static func window(_ root: some View) -> (NSWindow, NSHostingView<AnyView>) {
    let hosting = NSHostingView(rootView: AnyView(root))
    let window = NSWindow(
      contentRect: NSRect(x: -6000, y: -6000, width: 900, height: 800), styleMask: [.borderless],
      backing: .buffered, defer: false)
    window.contentView = hosting
    window.orderFrontRegardless()
    return (window, hosting)
  }

  /// Let the landing scroll and lazy measuring settle.
  private func settle(_ window: NSWindow, passes: Int = 20) async throws {
    for _ in 0..<passes {
      pass(window)
      try await Task.sleep(for: .milliseconds(20))
    }
  }

  private static let viewer = ImageViewerState()

  private static func root(_ messages: [RemoteMessage]?, store: HostStore) -> AnyView {
    AnyView(
      TranscriptView(agentKey: agent, sessionId: "perf", fixture: messages)
        .environment(store)
        .environment(viewer))
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

/// Answers `agents.transcript` with the fixture page and pushes the test's
/// events; everything else fails, as an empty host would.
private final class PageBackend: HostBackend, @unchecked Sendable {
  struct Unavailable: Error {}

  let kind = HostBackendKind.gateway
  private let page: Data
  private let stream: AsyncStream<HostEvent>
  private let continuation: AsyncStream<HostEvent>.Continuation

  init(page: Data) {
    self.page = page
    (stream, continuation) = AsyncStream<HostEvent>.makeStream()
  }

  func push(_ envelope: EventEnvelope) { continuation.yield(.event(envelope)) }

  func events() async -> AsyncStream<HostEvent> { stream }

  func request<Params: Encodable & Sendable, Result: Decodable & Sendable>(
    _ method: RemoteMethod, _ params: Params, as: Result.Type
  ) async throws -> Result {
    guard method == .agentsTranscript else { throw Unavailable() }
    return try ProtocolCodec.decoder.decode(Result.self, from: page)
  }

  func request<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) async throws -> C.Result {
    throw Unavailable()
  }

  func subscribe(agentId: String, on: Bool) async {}

  func disconnect() async { continuation.finish() }
}
