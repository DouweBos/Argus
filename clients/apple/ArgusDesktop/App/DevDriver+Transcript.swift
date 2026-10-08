#if DEBUG
  import AppKit
  import ArgusCore
  import ArgusUI
  import QuartzCore
  import SwiftUI

  /// Dev-driver ops for measuring the transcript in a running build:
  ///
  /// - `transcriptSeed` (`repoRoot`, `branch`, `count`, `title`): saves a
  ///   `TranscriptFixture` chat as the project's chat history, through the host.
  /// - `transcriptScroll` (`style`: `trackpad` | `mouse` | `fling`, `gestures`,
  ///   `untilTop`, `out`): wheel events into the transcript's scroll view, the
  ///   way AppKit delivers them, with hangs, frame times and memory written to `out`.
  /// - `transcriptResize` (`out`): a sidebar-drag-sized resize of the window.
  /// - `hangMeter` (`action`: `start` | `stop`): the long main-thread passes in between.
  @MainActor
  enum TranscriptDriver {
    static func run(_ command: [String: Any], window: NSWindow) -> [String: Any]? {
      switch command["op"] as? String {
      case "transcriptSeed":
        guard let model = AppDelegate.current?.model, let backend = model.backend,
          let repoRoot = command["repoRoot"] as? String
        else { return ["error": "repoRoot? / no host"] }
        let count = command["count"] as? Int ?? 3000
        let messages = TranscriptFixture.messages(count: count)
        let saved = TranscriptFixture.saved(messages)
        guard let data = try? JSONSerialization.data(withJSONObject: saved),
          let json = try? JSONDecoder().decode([JSONValue].self, from: data)
        else { return ["error": "encode"] }
        let now = Date().timeIntervalSince1970 * 1000
        let conversation = ArgusProtocol.SavedConversation(
          createdAt: now - 86_400_000, endedAt: now, id: "fixture-\(count)", messageCount: Double(count),
          sessionBranch: command["branch"] as? String ?? "main", sessionDescription: "",
          sessionId: "fixture-session-\(count)", title: command["title"] as? String ?? "Long fixture chat",
          messages: json)
        seeded = nil
        Task {
          do {
            try await backend.request(
              ArgusProtocol.Commands.SaveChatHistory.self, .init(repoRoot: repoRoot, conversation: conversation))
            seeded = "ok"
          } catch {
            seeded = "\(error)"
          }
        }
        return ["ok": true, "bytes": data.count]
      case "transcriptSeeded":
        return ["seeded": seeded ?? "pending"]
      case "transcriptOpenFixture":
        // The fixture in the app's own transcript view, in a window of its own:
        // `paged` serves it through a stand-in host a page at a time, as a
        // saved chat opens; otherwise the view holds all of it.
        guard let model = AppDelegate.current?.model else { return ["error": "no model"] }
        let count = command["count"] as? Int ?? 3000
        let start = CACurrentMediaTime()
        // Built once per count, so a second open measures only the transcript.
        let (messages, images) = prepared[count] ?? prepare(count)
        prepared[count] = (messages, images)
        let built = CACurrentMediaTime() - start
        let paged = command["paged"] as? Bool ?? true
        let store = paged ? HostStore() : model.store
        if !paged {
          for (id, data) in images { store.seedImage(agentId: "fixture", imageId: id, dataURI: "data:image/png;base64,\(data)") }
        }
        let size = NSSize(width: command["width"] as? Double ?? 900, height: command["height"] as? Double ?? 900)
        let live = command["live"] as? Bool ?? false
        let key =
          live ? "fixture-live" : paged ? HostStore.stoppedKey(repoRoot: "/fixture", historyId: "fixture") : "fixture"
        fixtureKey = key
        streamRevision = 0
        Task {
          if paged {
            let backend = FixtureBackend(messages: messages, images: images)
            fixtureBackend = backend
            await store.attach(backend)
          }
          let root = TranscriptView(agentKey: key, sessionId: "fixture", fixture: paged ? nil : messages)
            .environment(model)
            .environment(store)
            .environment(ImageViewerState())
            .themed()
          fixtureStore = store
          fixtureWindow?.close()
          let window = NSWindow(
            contentRect: NSRect(origin: NSPoint(x: 80, y: 80), size: size),
            styleMask: [.titled, .resizable, .closable], backing: .buffered, defer: false)
          window.title = "Transcript Fixture"
          window.isReleasedWhenClosed = false
          window.contentView = NSHostingView(rootView: root)
          window.orderFront(nil)
          fixtureWindow = window
        }
        return ["ok": true, "messages": messages.count, "build_ms": Stats.ms(built)]
      case "transcriptScroll":
        guard let scrollView = transcriptScrollView(in: window), let out = command["out"] as? String else {
          return ["error": "no transcript / out?"]
        }
        let bench = WheelBench(scrollView: scrollView, command: command)
        Task {
          let report = await bench.run()
          write(report, to: out)
        }
        return ["ok": true, "content": scrollView.documentView?.frame.height ?? 0]
      case "transcriptStream":
        // Tokens streamed into the last message of a `live` fixture, through the store.
        guard let store = fixtureStore, let backend = fixtureBackend, let out = command["out"] as? String,
          var last = store.messagesByAgent[fixtureKey]?.last
        else { return ["error": "open a live fixture first / out?"] }
        let count = command["count"] as? Int ?? 60
        let key = fixtureKey
        if command["pending"] as? Bool == true {
          // A call waiting on approval, as the last thing the agent did.
          let json = #"{"id":"fx-pending","role":"assistant","text_blocks":[],"tool_calls":[{"id":"c-pending","name":"Bash","input":{"command":"rm -rf build"},"result_blocks":[],"status":"pending"}]}"#
          guard let pending = try? JSONDecoder().decode(RemoteMessage.self, from: Data(json.utf8)) else { return [:] }
          streamRevision += 1
          try? backend.push(pending, agentId: key, revision: streamRevision)
          return ["ok": true]
        }
        Task {
          let meter = HangMeter()
          var applied: [Double] = []
          for index in 0..<count {
            last.textBlocks.append(index % 12 == 11 ? "\n\n" : "token \(index) ")
            let start = CACurrentMediaTime()
            streamRevision += 1
            try? backend.push(last, agentId: key, revision: streamRevision)
            while store.messagesByAgent[key]?.last != last, CACurrentMediaTime() - start < 2 { await Task.yield() }
            applied.append(CACurrentMediaTime() - start)
            try? await Task.sleep(for: .milliseconds(40))
          }
          var report = meter.stop()
          report["applied"] = Stats.of(applied)
          write(report, to: out)
        }
        return ["ok": true]
      case "transcriptMakeKey":
        // Key within this app only; the app isn't activated, so focus elsewhere stays put.
        window.makeKey()
        return ["key": window.isKeyWindow]
      case "transcriptResize":
        guard let out = command["out"] as? String else { return ["error": "out?"] }
        Task {
          let meter = HangMeter()
          let start = window.frame.size
          var steps: [Double] = []
          let widths = Array(stride(from: 0, through: 300, by: 10)) + Array(stride(from: 300, through: 0, by: -10))
          for delta in widths {
            let begin = CACurrentMediaTime()
            window.setContentSize(NSSize(width: start.width - CGFloat(delta), height: window.contentLayoutRect.height))
            window.contentView?.layoutSubtreeIfNeeded()
            window.displayIfNeeded()
            steps.append(CACurrentMediaTime() - begin)
            try? await Task.sleep(for: .milliseconds(16))
          }
          var report = meter.stop()
          report["steps"] = Stats.of(steps)
          write(report, to: out)
        }
        return ["ok": true]
      case "hangMeter":
        if command["action"] as? String == "start" {
          meter = HangMeter()
          return ["ok": true]
        }
        let report = meter?.stop() ?? [:]
        meter = nil
        return report
      case "transcriptInfo":
        guard let scrollView = transcriptScrollView(in: window) else { return ["error": "no transcript"] }
        return [
          "offset": scrollView.contentView.bounds.origin.y,
          "content": scrollView.documentView?.frame.height ?? 0,
          "visible": scrollView.contentView.bounds.height,
          "flipped": scrollView.documentView?.isFlipped ?? false,
          "footprint_mb": Memory.footprintMB(),
        ]
      default:
        return nil
      }
    }

    private static var seeded: String?
    private static var fixtureWindow: NSWindow?
    private static var fixtureStore: HostStore?
    private static var fixtureBackend: FixtureBackend?
    private static var fixtureKey = ""
    /// Deltas must follow each other, as the host numbers them.
    private static var streamRevision = 0
    private static var meter: HangMeter?


    private static var prepared: [Int: ([RemoteMessage], [String: String])] = [:]

    private static func prepare(_ count: Int) -> ([RemoteMessage], [String: String]) {
      let fixture = TranscriptFixture.messages(count: count)
      let messages = TranscriptFixture.remote(fixture)
      var images: [String: String] = [:]
      for (message, raw) in zip(messages, TranscriptFixture.saved(fixture)) {
        var ids = (message.images ?? []).map(\.imageId)
        for call in message.toolCalls {
          for case .image(let id, _) in call.resultBlocks { ids.append(id) }
        }
        let data =
          ((raw["images"] as? [[String: Any]])?.first?["data"] as? String)
          ?? (((raw["toolCalls"] as? [[String: Any]])?.first?["result"] as? [[String: Any]])?.first?["source"]
            as? [String: Any])?["data"] as? String
        for id in ids { images[id] = data ?? "" }
      }
      return (messages, images)
    }

    private static func write(_ report: [String: Any], to path: String) {
      if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
        try? data.write(to: URL(fileURLWithPath: path))
      }
    }

    /// The tallest scroll view in the window is the transcript.
    static func transcriptScrollView(in window: NSWindow) -> NSScrollView? {
      func scan(_ view: NSView) -> [NSScrollView] {
        ((view as? NSScrollView).map { [$0] } ?? []) + view.subviews.flatMap(scan)
      }
      return window.contentView.map(scan)?.max {
        ($0.documentView?.frame.height ?? 0) < ($1.documentView?.frame.height ?? 0)
      }
    }
  }

  enum Memory {
    static func footprintMB() -> Double {
      var info = task_vm_info_data_t()
      var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
      let result = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
          task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
        }
      }
      guard result == KERN_SUCCESS else { return 0 }
      return (Double(info.phys_footprint) / 1_048_576 * 10).rounded() / 10
    }
  }

  enum Stats {
    static func of(_ seconds: [Double]) -> [String: Double] {
      let sorted = seconds.sorted()
      guard !sorted.isEmpty else { return [:] }
      func at(_ p: Double) -> Double { ms(sorted[min(sorted.count - 1, Int(Double(sorted.count) * p))]) }
      return ["count": Double(sorted.count), "p50_ms": at(0.5), "p95_ms": at(0.95), "p99_ms": at(0.99), "max_ms": ms(sorted.last!)]
    }

    static func ms(_ seconds: Double) -> Double { (seconds * 10_000).rounded() / 10 }
  }

  /// Every main run-loop pass while it runs; passes over 100 ms are hangs.
  @MainActor
  final class HangMeter {
    private var observer: CFRunLoopObserver?
    private var passStart: CFTimeInterval = 0
    private let began = CACurrentMediaTime()
    private(set) var passes: [Double] = []
    private var long: [[String: Double]] = []

    init() {
      let observer = CFRunLoopObserverCreateWithHandler(
        nil, CFRunLoopActivity.afterWaiting.rawValue | CFRunLoopActivity.beforeWaiting.rawValue, true, 0
      ) { [weak self] _, activity in
        MainActor.assumeIsolated {
          guard let self else { return }
          let now = CACurrentMediaTime()
          if activity == .afterWaiting {
            self.passStart = now
          } else if self.passStart > 0 {
            let pass = now - self.passStart
            self.passes.append(pass)
            if pass > 0.05 { self.long.append(["at_s": Stats.ms(self.passStart - self.began) / 1000, "ms": Stats.ms(pass)]) }
            self.passStart = 0
          }
        }
      }
      CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
      self.observer = observer
    }

    func stop() -> [String: Any] {
      if let observer { CFRunLoopRemoveObserver(CFRunLoopGetMain(), observer, .commonModes) }
      observer = nil
      return [
        "passes": Stats.of(passes),
        "hangs_over_100ms": passes.filter { $0 > 0.1 }.count,
        "passes_over_50ms": long,
        "longest_ms": Stats.ms(passes.max() ?? 0),
      ]
    }
  }

  /// Scroll-wheel events at the display's rate into the transcript, through
  /// the window as AppKit routes a real wheel: trackpad gestures (phased,
  /// pixel deltas), a notched mouse wheel (lines), or flings (a short gesture
  /// then momentum). Frame time is the gap between event ticks, which a busy
  /// main thread stretches.
  @MainActor
  private final class WheelBench {
    private let scrollView: NSScrollView
    private let style: String
    private let gestures: Int
    private let untilTop: Bool
    private let maxSeconds: Double
    /// Trackpad phases on the events. A responsive scroll view tracks a phased
    /// gesture from the system's own event stream and takes only the first
    /// event sent in-process, so by default these are precise deltas without
    /// phases: the same movement per frame, the same rows to lay out.
    private let phased: Bool
    /// Scales every delta, to cross a long history in reasonable time.
    private let speed: Double

    init(scrollView: NSScrollView, command: [String: Any]) {
      self.scrollView = scrollView
      style = command["style"] as? String ?? "trackpad"
      gestures = command["gestures"] as? Int ?? 1
      untilTop = command["untilTop"] as? Bool ?? false
      maxSeconds = command["seconds"] as? Double ?? 600
      phased = command["phased"] as? Bool ?? false
      speed = command["speed"] as? Double ?? 1
    }

    func run() async -> [String: Any] {
      let meter = HangMeter()
      var ticks: [Double] = []
      var memory: [Double] = [Memory.footprintMB()]
      let began = CACurrentMediaTime()
      var last = began
      var lastMemory = began
      var travelled: CGFloat = 0
      var stillAtTop = 0
      let startContent = scrollView.documentView?.frame.height ?? 0
      let startOffset = scrollView.contentView.bounds.origin.y

      var lastOffset = scrollView.contentView.bounds.origin.y
      func tick() async {
        try? await Task.sleep(for: .milliseconds(8))
        let offset = scrollView.contentView.bounds.origin.y
        travelled += abs(offset - lastOffset)
        lastOffset = offset
        let now = CACurrentMediaTime()
        ticks.append(now - last)
        last = now
        if now - lastMemory > 1 {
          memory.append(Memory.footprintMB())
          lastMemory = now
        }
      }
      func send(_ delta: Double, phase: Int64 = 0, momentum: Int64 = 0, lines: Bool = false) {
        post(delta, phase: phase, momentum: momentum, lines: lines)
      }

      var gesture = 0
      while CACurrentMediaTime() - began < maxSeconds {
        gesture += 1
        // A reader going back through history: drags and flings up, and now
        // and then a fling back down.
        let current = style == "mixed" ? ["trackpad", "fling", "trackpad", "flingDown"][gesture % 4] : style
        switch current {
        case "mouse":
          // Notches a few frames apart, three lines each, as a wheel mouse sends.
          for _ in 0..<8 {
            send(3, lines: true)
            for _ in 0..<3 { await tick() }
          }
        case "fling", "flingDown":
          let sign = current == "flingDown" ? -1.0 : 1
          send(0, phase: 1)
          for step in 0..<6 {
            send(sign * Double(20 + step * 15) * speed, phase: 2)
            await tick()
          }
          send(0, phase: 4)
          var velocity = 120.0 * speed
          send(sign * velocity, momentum: 1)
          while velocity > speed {
            await tick()
            velocity *= 0.95
            send(sign * velocity, momentum: 2)
          }
          send(0, momentum: 3)
        default:
          // A two-finger drag: 30 frames of 8–24 pt, then lift.
          send(0, phase: 1)
          for step in 0..<30 {
            send((8 + Double(step % 5) * 4) * speed, phase: 2)
            await tick()
          }
          send(0, phase: 4)
        }
        await tick()
        if !untilTop, gesture >= gestures { break }
        if untilTop {
          let atTop = scrollView.contentView.bounds.origin.y <= 0.5
          stillAtTop = atTop ? stillAtTop + 1 : 0
          // At the top with nothing left to page in for a couple of seconds.
          if stillAtTop > 12 { break }
        }
      }
      // Let anything the scroll scheduled run inside the measurement.
      for _ in 0..<30 { await tick() }
      memory.append(Memory.footprintMB())
      var report = meter.stop()
      report["style"] = style
      report["gestures"] = gesture
      report["seconds"] = Stats.ms(CACurrentMediaTime() - began) / 1000
      report["frames"] = Stats.of(ticks)
      report["travelled_pt"] = Int(travelled)
      report["content_start"] = startContent
      report["content_end"] = scrollView.documentView?.frame.height ?? 0
      report["offset_start"] = startOffset
      report["offset_end"] = scrollView.contentView.bounds.origin.y
      report["memory_mb"] = ["start": memory.first ?? 0, "max": memory.max() ?? 0, "end": memory.last ?? 0]
      return report
    }

    /// Positive deltas scroll toward older content, as a real wheel does.
    private func post(_ delta: Double, phase: Int64, momentum: Int64, lines: Bool) {
      let phase = phased ? phase : 0
      let momentum = phased ? momentum : 0
      guard let window = scrollView.window,
        let cg = CGEvent(
          scrollWheelEvent2Source: nil, units: lines ? .line : .pixel, wheelCount: 1,
          wheel1: Int32(delta.rounded()), wheel2: 0, wheel3: 0)
      else { return }
      if !lines {
        cg.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
        cg.setIntegerValueField(.scrollWheelEventScrollPhase, value: phase)
        cg.setIntegerValueField(.scrollWheelEventMomentumPhase, value: momentum)
        cg.setDoubleValueField(.scrollWheelEventPointDeltaAxis1, value: delta)
        cg.setDoubleValueField(.scrollWheelEventFixedPtDeltaAxis1, value: delta)
      }
      // An event built from a CGEvent has no window, so AppKit reads its screen
      // location as the window location: put the scroll view's centre there.
      let center = scrollView.convert(NSPoint(x: scrollView.bounds.midX, y: scrollView.bounds.midY), to: nil)
      let screenHeight = NSScreen.screens.first?.frame.height ?? 0
      cg.location = CGPoint(x: center.x, y: screenHeight - center.y)
      guard let event = NSEvent(cgEvent: cg) else { return }
      // What the transcript's event monitor does with real input, which a
      // window-addressed event never passes through.
      if (scrollView as? TranscriptScrollView)?.takeWheel(event) == true { return }
      window.sendEvent(event)
    }
  }
#endif

#if DEBUG
  /// The host's `agents.stopped_transcript` / `agents.stopped_image` over a
  /// fixture, paged the way the host pages a saved chat, so the transcript
  /// runs its real open-and-page-older path without a chat on disk.
  final class FixtureBackend: HostBackend, @unchecked Sendable {
    struct Unavailable: Error {}

    let kind = HostBackendKind.gateway
    private let messages: [RemoteMessage]
    private let images: [String: String]
    private let stream: AsyncStream<HostEvent>
    private let continuation: AsyncStream<HostEvent>.Continuation

    init(messages: [RemoteMessage], images: [String: String]) {
      self.messages = messages
      self.images = images
      (stream, continuation) = AsyncStream<HostEvent>.makeStream()
    }

    func events() async -> AsyncStream<HostEvent> { stream }

    func request<Params: Encodable & Sendable, Result: Decodable & Sendable>(
      _ method: RemoteMethod, _ params: Params, as: Result.Type
    ) async throws -> Result {
      let args =
        (try? JSONSerialization.jsonObject(with: ProtocolCodec.encoder.encode(params)) as? [String: Any]) ?? [:]
      // A local host answers a page in a few tens of milliseconds.
      try await Task.sleep(for: .milliseconds(30))
      switch method {
      case .agentsStoppedTranscript, .agentsTranscript:
        let total = messages.count
        let size = args["limit"] as? Int ?? 100
        let end = min((args["before"] as? Double).map { Int($0) } ?? total, total)
        let start = max(0, end - size)
        let page = RemoteTranscript(
          messages: Array(messages[start..<end]), nextAfter: end < total ? Double(end) : nil,
          prevBefore: start > 0 ? Double(start) : nil, total: total, tasks: nil, todos: nil, model: nil,
          pendingToolName: nil, epoch: "fixture", revision: 0)
        return try ProtocolCodec.decoder.decode(Result.self, from: ProtocolCodec.encoder.encode(page))
      case .agentsQueueList:
        let queued = #"{"messages":[{"id":"q1","text":"Then run the tests again.","queued_at":1760000000000}]}"#
        return try ProtocolCodec.decoder.decode(Result.self, from: Data(queued.utf8))
      case .agentsStoppedImage:
        guard let id = args["image_id"] as? String, let data = images[id] else { throw Unavailable() }
        let image = try JSONSerialization.data(withJSONObject: ["data": data, "media_type": "image/png"])
        return try ProtocolCodec.decoder.decode(Result.self, from: image)
      default:
        throw Unavailable()
      }
    }

    func request<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) async throws -> C.Result {
      throw Unavailable()
    }

    /// An `agent.transcript` delta upserting `message`, as the host streams one.
    func push(_ message: RemoteMessage, agentId: String, revision: Int) throws {
      let encoded = String(decoding: try ProtocolCodec.encoder.encode(message), as: UTF8.self)
      let payload =
        #"{"agent_id":"\#(agentId)","epoch":"fixture","revision":\#(revision),"total":\#(messages.count),"#
        + #""messages":[\#(encoded)],"removed_ids":[],"title":null,"model":null,"pending_tool_name":null,"#
        + #""tasks":null,"todos":null}"#
      let frame = #"{"seq":\#(revision),"event":"agent.transcript","agent_id":"\#(agentId)","payload":\#(payload)}"#
      continuation.yield(.event(try ProtocolCodec.decoder.decode(EventEnvelope.self, from: Data(frame.utf8))))
    }

    func subscribe(agentId: String, on: Bool) async {}

    func disconnect() async { continuation.finish() }
  }
#endif
