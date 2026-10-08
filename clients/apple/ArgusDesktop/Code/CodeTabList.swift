import Foundation

/// A session's editor tabs, VS Code style: a single click opens a reusable
/// preview tab, editing or a double click pins it. Pure, so it's testable;
/// which tab is active lives in the route, not here.
struct CodeTabList: Equatable, Codable {
  struct Tab: Equatable, Codable, Hashable {
    var path: String
    var isPreview: Bool
  }

  static let cap = 20

  private(set) var tabs: [Tab] = []

  var paths: [String] { tabs.map(\.path) }
  var previewPath: String? { tabs.first { $0.isPreview }?.path }

  func contains(_ path: String) -> Bool { tabs.contains { $0.path == path } }

  /// Opens `path`, reusing the preview tab for a preview. Returns the paths it
  /// closed: the replaced preview, and the oldest clean tabs over the cap.
  @discardableResult
  mutating func open(_ path: String, preview: Bool, isDirty: (String) -> Bool = { _ in false }) -> [String] {
    if let index = tabs.firstIndex(where: { $0.path == path }) {
      if !preview { tabs[index].isPreview = false }
      return []
    }
    var closed: [String] = []
    let tab = Tab(path: path, isPreview: preview)
    if preview, let index = tabs.firstIndex(where: { $0.isPreview }), !isDirty(tabs[index].path) {
      closed.append(tabs[index].path)
      tabs[index] = tab
    } else {
      tabs.append(tab)
    }
    while tabs.count > Self.cap,
      let oldest = tabs.firstIndex(where: { $0.path != path && !isDirty($0.path) })
    {
      closed.append(tabs.remove(at: oldest).path)
    }
    return closed
  }

  /// Editing or double-clicking a preview tab keeps it.
  mutating func pin(_ path: String) {
    guard let index = tabs.firstIndex(where: { $0.path == path }) else { return }
    tabs[index].isPreview = false
  }

  /// Closes `path`; returns the tab that takes its place when it was `active`.
  @discardableResult
  mutating func close(_ path: String, active: String?) -> String? {
    guard let index = tabs.firstIndex(where: { $0.path == path }) else { return active }
    tabs.remove(at: index)
    guard active == path else { return active }
    guard !tabs.isEmpty else { return nil }
    return tabs[min(max(index - 1, 0), tabs.count - 1)].path
  }

  /// A file renamed or deleted under the tab.
  mutating func rename(_ path: String, to newPath: String) {
    guard let index = tabs.firstIndex(where: { $0.path == path }) else { return }
    tabs[index].path = newPath
  }
}

extension CodeTabList {
  private static func key(_ sessionId: String) -> String { "code.tabs.\(sessionId)" }

  @MainActor
  static func restored(sessionId: String) -> CodeTabList {
    HomeDefaults.shared.data(forKey: key(sessionId))
      .flatMap { try? JSONDecoder().decode(CodeTabList.self, from: $0) } ?? CodeTabList()
  }

  @MainActor
  func save(sessionId: String) {
    HomeDefaults.shared.set(try? JSONEncoder().encode(self), forKey: Self.key(sessionId))
  }

  @MainActor
  static func forget(sessionId: String) {
    HomeDefaults.shared.removeObject(forKey: key(sessionId))
  }
}
