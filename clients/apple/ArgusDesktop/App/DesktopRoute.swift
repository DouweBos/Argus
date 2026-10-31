import ArgusCore

/// Which screen the window shows — the single source of truth, mirroring
/// `docs/routing.md`. Views read it; navigation goes through `DesktopModel.navigate`.
typealias DesktopRoute = ArgusRoute

/// A window route plus the machine it reads from; nil host is this Mac.
typealias DesktopLocation = ArgusLocation
