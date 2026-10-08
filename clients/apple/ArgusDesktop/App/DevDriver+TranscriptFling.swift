#if DEBUG
  import AppKit
  import QuartzCore

  /// `tFling` (`flings`, `velocity`, `direction`: `up` | `down`, `pauseMs`, `out`):
  /// trackpad flings as the window server sends them — a phased two-finger
  /// swipe, then momentum — posted to this process only, so they take the
  /// normal responsive-scrolling path. Every display frame meanwhile records
  /// the scroll offset, how long the main thread was busy, and whether any row
  /// on screen was mid-animation.
  @MainActor
  enum TranscriptFlingDriver {
    private static var recorder: FlingRecorder?

    static func run(_ command: [String: Any], window: NSWindow) -> [String: Any]? {
      if command["op"] as? String == "tBuildRows" { return buildRows(command, window: window) }
      guard command["op"] as? String == "tFling" else { return nil }
      guard let (scroll, table) = TranscriptInputDriver.transcript(in: window), let out = command["out"] as? String
      else { return ["error": "no transcript / out?"] }
      // A windowless event goes to whichever of our windows is topmost under its
      // point. A level, unlike ordering out, isn't saved with the window state.
      window.level = .floating
      let center = window.convertPoint(
        toScreen: scroll.convert(NSPoint(x: scroll.bounds.midX, y: scroll.bounds.midY), to: nil))
      let primary = NSScreen.screens.first?.frame.height ?? 0
      let plan = FlingPlan(
        flings: command["flings"] as? Int ?? 4, velocity: command["velocity"] as? Double ?? 60,
        sign: command["direction"] as? String == "down" ? -1 : 1, pause: (command["pauseMs"] as? Double ?? 250) / 1000,
        location: CGPoint(x: center.x, y: primary - center.y), window: window.windowNumber)
      TranscriptPerfLog.entries = []
      TranscriptPerfLog.recording = true
      let recorder = FlingRecorder(scroll: scroll, table: table)
      self.recorder = recorder
      Thread.detachNewThread {
        let sent = plan.post()
        DispatchQueue.main.async {
          MainActor.assumeIsolated {
            // Momentum still being applied when the last event left.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
              var report = recorder.stop()
              report["events_sent"] = sent
              TranscriptDriver.write(report, to: out)
              self.recorder = nil
              window.level = .normal
            }
          }
        }
      }
      return ["ok": true, "window": window.windowNumber]
    }
  }

  extension TranscriptFlingDriver {
    /// `tBuildRows` (`kind`, `count`): builds `count` hosted rows of a kind from
    /// scratch, off screen, as prefetch does, and reports each build's time.
    static func buildRows(_ command: [String: Any], window: NSWindow) -> [String: Any] {
      guard let (_, table) = TranscriptInputDriver.transcript(in: window),
        let controller = table.delegate as? TranscriptTableController
      else { return ["error": "no transcript"] }
      let kind = command["kind"] as? String ?? "message+Write"
      let indices = (0..<controller.rowCount).filter { controller.kind($0) == kind }
      guard !indices.isEmpty else { return ["error": "no \(kind) rows"] }
      var times: [Double] = []
      for step in 0..<(command["count"] as? Int ?? 50) {
        let start = CACurrentMediaTime()
        _ = controller.buildFresh(indices[step % indices.count])
        times.append(CACurrentMediaTime() - start)
      }
      return ["kind": kind, "rows": indices.count, "build": Stats.of(times)]
    }
  }

  /// One fling: six swipe events ramping up, lift, then momentum decaying the
  /// way AppKit's own does, all at the trackpad's 120 Hz.
  private struct FlingPlan: Sendable {
    let flings: Int
    let velocity: Double
    let sign: Double
    let pause: TimeInterval
    let location: CGPoint
    let window: Int

    func post() -> Int {
      var count = 0
      let frame = 1.0 / 120
      func send(_ delta: Double, phase: Int64 = 0, momentum: Int64 = 0) {
        guard
          let event = CGEvent(
            scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: Int32((sign * delta).rounded()),
            wheel2: 0, wheel3: 0)
        else { return }
        event.location = location
        event.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
        event.setIntegerValueField(.scrollWheelEventScrollPhase, value: phase)
        event.setIntegerValueField(.scrollWheelEventMomentumPhase, value: momentum)
        event.setDoubleValueField(.scrollWheelEventPointDeltaAxis1, value: sign * delta)
        event.setDoubleValueField(.scrollWheelEventFixedPtDeltaAxis1, value: sign * delta)
        event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(window))
        event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(window))
        event.postToPid(getpid())
        count += 1
        Thread.sleep(forTimeInterval: frame)
      }
      for _ in 0..<flings {
        send(2, phase: 1)
        for step in [6.0, 14, 24, 34, 42, 48] { send(step * velocity / 60, phase: 2) }
        send(0, phase: 4)
        var speed = velocity
        send(speed, momentum: 1)
        while speed > 0.5 {
          speed *= 0.97
          send(speed, momentum: 2)
        }
        send(0, momentum: 3)
        Thread.sleep(forTimeInterval: pause)
      }
      return count
    }
  }

  /// Per display frame: offset, busy time, and rows caught animating.
  @MainActor
  private final class FlingRecorder: NSObject {
    private let scroll: NSScrollView
    private let table: NSTableView
    private var link: CADisplayLink?
    private var observer: CFRunLoopObserver?
    private var passStart: CFTimeInterval = 0
    private var passes: [Double] = []
    private var frames: [[String: Double]] = []
    private var animatedFrames = 0
    private var overlapFrames = 0
    private let began = CACurrentMediaTime()
    private var monitor: Any?
    private var passEntries = 0
    private var mark: CFRunLoopObserver?
    private var commitStart: CFTimeInterval = 0
    private var slow: [String] = []
    private var seen: [String: Int] = [:]

    init(scroll: NSScrollView, table: NSTableView) {
      self.scroll = scroll
      self.table = table
      super.init()
      let observer = CFRunLoopObserverCreateWithHandler(
        nil, CFRunLoopActivity.afterWaiting.rawValue | CFRunLoopActivity.beforeWaiting.rawValue, true, 0
      ) { [weak self] _, activity in
        MainActor.assumeIsolated {
          guard let self else { return }
          if activity == .afterWaiting {
            self.passStart = CACurrentMediaTime()
            self.passEntries = TranscriptPerfLog.entries.count
          } else if self.passStart > 0 {
            let pass = CACurrentMediaTime() - self.passStart
            self.passes.append(pass)
            if pass > 0.0167 {
              let steps = TranscriptPerfLog.entries[self.passEntries...].map { "\($0.label) \(Int($0.ms))" }
              let commit = self.commitStart > self.passStart ? CACurrentMediaTime() - self.commitStart : 0
              self.slow.append("\(Int(pass * 1000)) ms (commit \(Int(commit * 1000))): " + steps.joined(separator: ", "))
            }
            self.passStart = 0
          }
        }
      }
      CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
      self.observer = observer
      // First of the before-waiting observers: what's left of the pass after
      // this is AppKit's display cycle and Core Animation's commit.
      let mark = CFRunLoopObserverCreateWithHandler(nil, CFRunLoopActivity.beforeWaiting.rawValue, true, Int.min) {
        [weak self] _, _ in
        MainActor.assumeIsolated { self?.commitStart = CACurrentMediaTime() }
      }
      CFRunLoopAddObserver(CFRunLoopGetMain(), mark, .commonModes)
      self.mark = mark
      let link = scroll.displayLink(target: self, selector: #selector(tick(_:)))
      link.add(to: .main, forMode: .common)
      self.link = link
      monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
        nonisolated(unsafe) let event = event
        MainActor.assumeIsolated {
          let key = "p\(event.phase.rawValue)m\(event.momentumPhase.rawValue)w\(event.windowNumber)-\(event.window?.title ?? "nil")"
          self?.seen[key, default: 0] += 1
        }
        return event
      }
    }

    /// Where each row on screen sat last frame, by id, in viewport points.
    private var lastRows: [String: CGFloat] = [:]
    private var skewedFrames = 0

    @objc private func tick(_ link: CADisplayLink) {
      let clip = scroll.contentView.bounds
      let visible = table.rows(in: clip)
      var animating = false
      var rects: [NSRect] = []
      // What the reader sees: how far the rows on screen moved, and whether
      // they all moved together (a row resizing on screen moves only some).
      let controller = table.delegate as? TranscriptTableController
      var rows: [String: CGFloat] = [:]
      for index in visible.location..<(visible.location + visible.length) {
        if let id = controller?.id(index) { rows[id] = table.rect(ofRow: index).minY - clip.minY }
      }
      let moves = rows.compactMap { id, y in lastRows[id].map { y - $0 } }
      let move = moves.isEmpty ? 0 : moves.sorted()[moves.count / 2]
      let skew = (moves.max() ?? 0) - (moves.min() ?? 0)
      if skew > 0.5 { skewedFrames += 1 }
      lastRows = rows
      for index in visible.location..<(visible.location + visible.length) {
        guard let row = table.rowView(atRow: index, makeIfNecessary: false) else { continue }
        let layers = [row.layer] + row.subviews.map(\.layer)
        if layers.contains(where: { !($0?.animationKeys() ?? []).isEmpty }) { animating = true }
        let shown = row.layer?.presentation()?.frame ?? row.frame
        rects.append(shown)
      }
      let sorted = rects.sorted { $0.minY < $1.minY }
      let overlap = zip(sorted, sorted.dropFirst()).contains { $0.maxY > $1.minY + 0.5 }
      if animating { animatedFrames += 1 }
      if overlap { overlapFrames += 1 }
      frames.append([
        "t": CACurrentMediaTime() - began, "y": clip.minY, "h": table.frame.height, "move": move, "skew": skew,
        "anim": animating ? 1 : 0, "overlap": overlap ? 1 : 0,
      ])
    }

    /// Views in the pane by class, the tree AppKit walks on every layout pass.
    private func census() -> [String: Int] {
      var counts: [String: Int] = [:]
      func walk(_ view: NSView) {
        counts["\(type(of: view))", default: 0] += 1
        counts["all", default: 0] += 1
        view.subviews.forEach(walk)
      }
      if let root = scroll.window?.contentView { walk(root) }
      return counts.filter { $0.value >= 10 }
    }

    func stop() -> [String: Any] {
      let views = census()
      link?.invalidate()
      link = nil
      if let monitor { NSEvent.removeMonitor(monitor) }
      monitor = nil
      if let observer { CFRunLoopRemoveObserver(CFRunLoopGetMain(), observer, .commonModes) }
      observer = nil
      if let mark { CFRunLoopRemoveObserver(CFRunLoopGetMain(), mark, .commonModes) }
      mark = nil
      TranscriptPerfLog.recording = false
      var steps: [String: [Double]] = [:]
      for entry in TranscriptPerfLog.entries { steps[entry.label, default: []].append(entry.ms) }
      let perf = steps.mapValues { ms in
        ["count": Double(ms.count), "total_ms": Stats.ms(ms.reduce(0, +) / 1000), "max_ms": Stats.ms((ms.max() ?? 0) / 1000)]
      }
      let gaps = zip(frames, frames.dropFirst()).map { ($1["t"] ?? 0) - ($0["t"] ?? 0) }
      return [
        "frames": frames, "steps_over_1ms": perf, "slow_passes": slow, "frame_count": frames.count,
        "frame_gap": Stats.of(gaps), "frame_gaps_over_50ms": gaps.filter { $0 > 0.05 }.count,
        "busy": Stats.of(passes), "busy_over_16ms": passes.filter { $0 > 0.0167 }.count,
        "rows_animating_frames": animatedFrames, "events_seen": seen, "transcript_wheels": TranscriptScrollView.wheelsReceived, "rows_overlapping_frames": overlapFrames, "rows_skewed_frames": skewedFrames, "views": views,
      ]
    }
  }
#endif
