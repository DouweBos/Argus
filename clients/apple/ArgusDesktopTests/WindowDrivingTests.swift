import Testing

/// Suites that drive a real window and pump the main run loop. Run side by side,
/// one's scrolling starves the other's layout passes, so they take turns.
@MainActor
@Suite(.serialized)
enum WindowDrivingTests {}
