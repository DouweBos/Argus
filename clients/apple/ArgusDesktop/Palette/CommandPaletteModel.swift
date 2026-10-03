import ArgusCore
import Foundation
import Observation

/// One row in the command palette.
struct PaletteCommand: Identifiable {
  let id: String
  let title: String
  /// The group it's listed under ("Navigate", "Session", "Git", …).
  let section: String
  var subtitle: String? = nil
  /// Extra words it should match on, beyond its title.
  var keywords: [String] = []
  var systemImage: String? = nil
  /// Display only, e.g. "⇧⌘T"; the menu owns the real binding.
  var shortcut: String? = nil
  /// Runs, then opens the Settings scene — which only a view can open.
  var opensSettings = false
  let run: @MainActor () -> Void
}

/// The command palette (⇧⌘P): commands come from registered sources, read
/// fresh each time it opens so they reflect the screen you're on.
///
/// A feature adds its commands with `register(_:_:)` — git's views register a
/// `"git"` source the same way the built-in ones do.
@MainActor
@Observable
final class CommandPaletteModel {
  typealias Source = @MainActor (DesktopModel) -> [PaletteCommand]

  var isPresented = false
  @ObservationIgnored private var sources: [(id: String, provide: Source)] = []

  /// Adds a source, or replaces the one already registered under `id`.
  func register(_ id: String, _ provide: @escaping Source) {
    sources.removeAll { $0.id == id }
    sources.append((id, provide))
  }

  func unregister(_ id: String) {
    sources.removeAll { $0.id == id }
  }

  func commands(for model: DesktopModel) -> [PaletteCommand] {
    sources.flatMap { $0.provide(model) }
  }

  func matching(_ query: String, for model: DesktopModel) -> [PaletteCommand] {
    PaletteMatch.rank(commands(for: model), query: query) {
      [$0.title, "\($0.section) \($0.title)"] + $0.keywords + ($0.subtitle.map { [$0] } ?? [])
    }
  }
}
