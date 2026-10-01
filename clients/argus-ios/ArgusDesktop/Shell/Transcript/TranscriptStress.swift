import AppKit
import ArgusCore
import QuartzCore

/// Debug-only stress fixture: `ARGUS_TRANSCRIPT_STRESS=<count>` makes every
/// agent pane render `count` synthetic messages (markdown, code, long tool
/// output, collapsed groups), then scrolls, searches and writes timings to
/// `/tmp/argus-transcript-stress-<pid>.json`.
enum TranscriptStress {
  #if DEBUG
    static let count = ProcessInfo.processInfo.environment["ARGUS_TRANSCRIPT_STRESS"].flatMap(Int.init)
    nonisolated(unsafe) static var createdAt: CFTimeInterval = 0
    static let fixture: [RemoteMessage]? = count.map(makeMessages)
  #else
    static let fixture: [RemoteMessage]? = nil
  #endif
}

#if DEBUG
  extension TranscriptStress {
    static func makeMessages(_ count: Int) -> [RemoteMessage] {
      createdAt = CACurrentMediaTime()
      var json: [[String: Any]] = []
      let output = (1...300).map { "src/module\($0 % 17)/File\($0).swift:\($0): warning: something long happened here \($0)" }
        .joined(separator: "\n")
      for index in 0..<count {
        let id = "stress-\(index)"
        switch index % 10 {
        case 0:
          json.append(["id": id, "role": "user", "text_blocks": ["Please look at `src/App.swift:\(index)` and fix the needle \(index) bug."], "tool_calls": []])
        case 1, 5:
          json.append([
            "id": id, "role": "assistant", "tool_calls": [],
            "text_blocks": [
              """
              ## Step \(index)

              I read **ArgusDesktop/Shell/Session/SessionView.swift:42** and the `HostStore` — here is what I found about message \(index):

              - The transcript renders *markdown* with [links](https://example.com/\(index)).
              - Paths like ./clients/argus-ios/README.md and /tmp/argus/file\(index).ts:3:9 are links.
              - A needle hides in here.

              ```swift
              func render(_ index: Int) -> String {
                // see Sources/Render.swift:\(index)
                return "message \\(index)"
              }
              ```

              | Column | Value |
              |---|---|
              | index | \(index) |
              | kind | assistant |
              """
            ],
          ])
        case 2, 3, 4:
          json.append([
            "id": id, "role": "assistant", "text_blocks": [],
            "tool_calls": [[
              "id": "call-\(index)", "name": "Read", "status": "done",
              "input": ["file_path": "/tmp/argus/src/File\(index).swift"],
              "result_blocks": [["type": "text", "text": "1\tstruct File\(index) {}\n2\t// needle"]],
            ]],
          ])
        case 6:
          json.append([
            "id": id, "role": "assistant", "text_blocks": ["Running the build for \(index)."],
            "tool_calls": [[
              "id": "call-\(index)", "name": "Bash", "status": "done",
              "input": ["command": "xcodebuild -scheme ArgusDesktop build | tail -300"],
              "result_blocks": [["type": "text", "text": output]],
            ]],
          ])
        case 7:
          json.append([
            "id": id, "role": "assistant", "text_blocks": [],
            "tool_calls": [[
              "id": "call-\(index)", "name": "Edit", "status": "done",
              "input": [
                "file_path": "Sources/Edit\(index).swift", "old_string": "let a = 1\nlet b = 2",
                "new_string": "let a = 1\nlet b = 3\nlet c = 4",
              ],
              "result_blocks": [["type": "text", "text": "Edited."]],
            ]],
          ])
        default:
          json.append(["id": id, "role": "assistant", "text_blocks": ["Short reply \(index) — done."], "tool_calls": []])
        }
      }
      let data = try! JSONSerialization.data(withJSONObject: json)
      return try! JSONDecoder().decode([RemoteMessage].self, from: data)
    }

    /// Scrolls up and back down, then searches, and writes what it measured.
    @MainActor
    static func run(model: TranscriptModel, messages: [RemoteMessage]) async {
      var report: [String: Any] = ["messages": messages.count]
      guard let scrollView = await transcriptScrollView() else {
        NSLog("[argus] transcript stress: no scroll view found")
        return
      }
      report["first_render_ms"] = ms(CACurrentMediaTime() - createdAt)
      report["content_height_initial"] = scrollView.documentView?.frame.height ?? 0
      try? await Task.sleep(for: .seconds(1))

      let bench = ScrollBench(scrollView: scrollView)
      report["scroll_up"] = await bench.run(seconds: 12, pointsPerSecond: -4000)
      report["scroll_down"] = await bench.run(seconds: 6, pointsPerSecond: 4000)
      report["content_height_after_scroll"] = scrollView.documentView?.frame.height ?? 0

      var start = CACurrentMediaTime()
      model.openFind()
      model.query = "needle"
      model.search(messages)
      report["find_first_ms"] = ms(CACurrentMediaTime() - start)
      start = CACurrentMediaTime()
      model.search(messages)
      report["find_cached_ms"] = ms(CACurrentMediaTime() - start)
      report["find_hits"] = model.hits.count

      // Walk back through a few matches the way ⇧⌘G does.
      var steps: [Double] = []
      for _ in 0..<5 {
        start = CACurrentMediaTime()
        model.step(forward: false)
        try? await Task.sleep(for: .milliseconds(500))
        steps.append(ms(CACurrentMediaTime() - start - 0.5))
      }
      report["find_step_overhead_ms"] = steps

      let path = "/tmp/argus-transcript-stress-\(ProcessInfo.processInfo.processIdentifier).json"
      if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
        FileManager.default.createFile(atPath: path, contents: data)
      }
      NSLog("[argus] transcript stress: %@", String(describing: report))
    }

    private static func ms(_ seconds: CFTimeInterval) -> Double { (seconds * 10_000).rounded() / 10 }

    /// The tallest scroll view in the key window is the transcript.
    @MainActor
    private static func transcriptScrollView() async -> NSScrollView? {
      for _ in 0..<100 {
        let views = NSApp.windows.compactMap(\.contentView).flatMap(scrollViews)
        if let tallest = views.max(by: { ($0.documentView?.frame.height ?? 0) < ($1.documentView?.frame.height ?? 0) }),
          (tallest.documentView?.frame.height ?? 0) > tallest.contentView.bounds.height * 3
        {
          return tallest
        }
        try? await Task.sleep(for: .milliseconds(50))
      }
      return nil
    }

    @MainActor
    private static func scrollViews(in view: NSView) -> [NSScrollView] {
      ((view as? NSScrollView).map { [$0] } ?? []) + view.subviews.flatMap(scrollViews)
    }
  }

  /// Drives the clip view on the display link and records how late each
  /// frame's callback was — a main thread busy laying out rows shows as gaps.
  @MainActor
  private final class ScrollBench: NSObject {
    private let scrollView: NSScrollView
    private var link: CADisplayLink?
    private var last: CFTimeInterval = 0
    private var end: CFTimeInterval = 0
    private var speed: CGFloat = 0
    private var intervals: [Double] = []
    private var travelled: CGFloat = 0
    private var done: CheckedContinuation<Void, Never>?

    init(scrollView: NSScrollView) {
      self.scrollView = scrollView
    }

    func run(seconds: Double, pointsPerSecond: CGFloat) async -> [String: Any] {
      intervals = []
      travelled = 0
      last = 0
      speed = pointsPerSecond
      end = CACurrentMediaTime() + seconds
      await withCheckedContinuation { continuation in
        done = continuation
        let link = scrollView.displayLink(target: self, selector: #selector(tick(_:)))
        link.add(to: .main, forMode: .common)
        self.link = link
      }
      let frame = link.map { $0.targetTimestamp - $0.timestamp } ?? (1.0 / 60)
      link = nil
      let sorted = intervals.sorted()
      func percentile(_ p: Double) -> Double {
        sorted.isEmpty ? 0 : sorted[min(sorted.count - 1, Int(Double(sorted.count) * p))] * 1000
      }
      let hitches = intervals.filter { $0 > frame * 1.5 }
      return [
        "frames": intervals.count,
        "refresh_ms": (frame * 10_000).rounded() / 10,
        "p50_ms": (percentile(0.5) * 10).rounded() / 10,
        "p95_ms": (percentile(0.95) * 10).rounded() / 10,
        "p99_ms": (percentile(0.99) * 10).rounded() / 10,
        "max_ms": ((sorted.last ?? 0) * 10_000).rounded() / 10,
        "hitches": hitches.count,
        "hitch_time_ms": (hitches.reduce(0) { $0 + $1 - frame } * 10_000).rounded() / 10,
        "travelled_pt": Int(travelled),
      ]
    }

    @objc private func tick(_ link: CADisplayLink) {
      let now = CACurrentMediaTime()
      let dt = last > 0 ? now - last : link.targetTimestamp - link.timestamp
      if last > 0 { intervals.append(dt) }
      last = now

      let clip = scrollView.contentView
      let documentHeight = scrollView.documentView?.frame.height ?? 0
      let maxY = max(0, documentHeight - clip.bounds.height)
      let flipped = scrollView.documentView?.isFlipped ?? true
      let delta = speed * CGFloat(dt) * (flipped ? 1 : -1)
      var origin = clip.bounds.origin
      let target = min(max(0, origin.y + delta), maxY)
      travelled += abs(target - origin.y)
      origin.y = target
      clip.scroll(to: origin)
      scrollView.reflectScrolledClipView(clip)

      let atEdge = (speed < 0) == flipped ? target <= 0 : target >= maxY
      if now >= end || (atEdge && intervals.count > 10) {
        link.invalidate()
        done?.resume()
        done = nil
      }
    }
  }
#endif
