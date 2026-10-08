import QuartzCore

/// Debug-only: how long each transcript step took, for the dev driver's fling
/// probe to say which rows cost a frame. Release builds just run the body.
enum TranscriptPerfLog {
  #if DEBUG
    nonisolated(unsafe) static var entries: [(label: String, ms: Double)] = []
    nonisolated(unsafe) static var recording = false
  #endif

  @inline(__always)
  static func time<T>(_ label: @autoclosure () -> String, _ body: () -> T) -> T {
    #if DEBUG
      guard recording else { return body() }
      let start = CACurrentMediaTime()
      let result = body()
      let ms = (CACurrentMediaTime() - start) * 1000
      if ms > 1 { entries.append((label(), ms)) }
      return result
    #else
      return body()
    #endif
  }
}
