import AppKit
import ArgusCore
import Foundation
import Observation

/// One inspector's state: captures, selection, focus and search, plus the
/// probe → capture / launch-prompt flow — the renderer's inspection `store.ts`.
@MainActor
@Observable
final class InspectionModel {
  /// The app can't be read yet: one is running without injection (offer a
  /// restart), or nothing inspectable is foregrounded (offer a picker).
  struct LaunchPrompt: Equatable {
    var foregroundApp: String?
    var isSpringboard: Bool
  }

  struct Snapshot: Identifiable {
    let id = UUID()
    var capture: Inspection.Capture
    /// Decoded once; the overlay redraws on every hover.
    var image: NSImage?
  }

  private(set) var snapshots: [Snapshot] = []
  private(set) var activeId: UUID?
  private(set) var selectedId: String?
  /// The node treated as the hierarchy root; double-click sets it.
  private(set) var focusedRootId: String?
  var searchQuery = ""
  var expanded: Set<String> = []

  private(set) var capturing = false
  private(set) var launching = false
  private(set) var captureError: String?
  private(set) var launchPrompt: LaunchPrompt?
  /// Nil until fetched, for the picker and the running app's name.
  private(set) var installedApps: [ArgusProtocol.InstalledApp]?
  private(set) var editSaving = false
  private(set) var editError: String?

  private var backend: (any HostBackend)?
  private(set) var deviceKey: String?
  /// `select` is reported once per snapshot: "is selection used", not a click count.
  private var reportedSelection = false

  var active: Snapshot? { snapshots.first { $0.id == activeId } }

  /// The focused subtree, or the whole capture.
  var treeRoot: Inspection.Node? {
    guard let hierarchy = active?.capture.hierarchy else { return nil }
    return focusedRootId.flatMap { hierarchy.find($0) } ?? hierarchy
  }

  var selectedNode: Inspection.Node? {
    selectedId.flatMap { active?.capture.hierarchy.find($0) }
  }

  /// Root → focused node; empty when nothing is focused.
  var breadcrumbs: [Inspection.Node] {
    guard let focusedRootId, let hierarchy = active?.capture.hierarchy else { return [] }
    return hierarchy.path(to: focusedRootId)
  }

  func attach(backend: (any HostBackend)?, deviceKey: String?) {
    self.backend = backend
    guard deviceKey != self.deviceKey else { return }
    self.deviceKey = deviceKey
    clear()
  }

  // MARK: Capture

  /// Probe for the injected server first: capture when it's live, otherwise
  /// show the launch prompt rather than a raw error.
  func capture() async {
    guard let deviceKey, let backend else {
      captureError = "No active device — boot an iOS simulator first."
      return
    }
    capturing = true
    captureError = nil
    defer { capturing = false }
    do {
      let probe = try await backend.request(
        ArgusProtocol.Commands.InspectionProbe.self, .init(deviceKey: deviceKey))
      if probe.injected {
        add(try await fetch(backend, deviceKey))
        MacTelemetry.capture(.inspectionUsed(action: .capture, success: true))
        return
      }
      installedApps =
        (try? await backend.request(
          ArgusProtocol.Commands.InspectionListApps.self, .init(deviceKey: deviceKey))) ?? []
      launchPrompt = LaunchPrompt(
        foregroundApp: probe.foregroundApp, isSpringboard: probe.isSpringboard)
    } catch {
      captureError = HostStore.describe(error)
      MacTelemetry.capture(.inspectionUsed(action: .capture, success: false))
    }
  }

  /// Relaunch with the in-process library injected, then capture straight away.
  func relaunch(bundleId: String) async {
    guard let deviceKey, let backend else { return }
    launching = true
    captureError = nil
    defer { launching = false }
    do {
      try await backend.request(
        ArgusProtocol.Commands.InspectionLaunchInjected.self,
        .init(deviceKey: deviceKey, bundleId: bundleId))
      MacTelemetry.capture(.inspectionUsed(action: .launch, success: true))
      launchPrompt = nil
    } catch {
      captureError = HostStore.describe(error)
      MacTelemetry.capture(.inspectionUsed(action: .launch, success: false))
      return
    }
    await capture()
  }

  /// Live-edit a whitelisted property, then re-inspect in place so the panel
  /// shows what the device actually applied. Ids are stable within a launch,
  /// so the selection survives.
  @discardableResult
  func setProperty(nodeId: String, key: String, value: String) async -> Bool {
    guard let deviceKey, let backend else {
      editError = "No live device to edit against."
      return false
    }
    editSaving = true
    editError = nil
    defer { editSaving = false }
    do {
      try await backend.request(
        ArgusProtocol.Commands.InspectionSetProperty.self,
        .init(deviceKey: deviceKey, nodeId: nodeId, key: key, value: value))
      let next = try await fetch(backend, deviceKey)
      if let index = snapshots.firstIndex(where: { $0.id == activeId }) {
        snapshots[index].capture = next.capture
        snapshots[index].image = next.image
      }
      MacTelemetry.capture(.inspectionUsed(action: .edit, success: true))
      return true
    } catch {
      editError = HostStore.describe(error)
      MacTelemetry.capture(.inspectionUsed(action: .edit, success: false))
      return false
    }
  }

  func nodeProps(_ nodeId: String) async -> ArgusProtocol.NodeProps? {
    guard let deviceKey, let backend else { return nil }
    return try? await backend.request(
      ArgusProtocol.Commands.InspectionNodeProps.self,
      .init(deviceKey: deviceKey, nodeId: nodeId))
  }

  // MARK: Selection

  func select(_ id: String?) {
    selectedId = id
    if id != nil, !reportedSelection {
      reportedSelection = true
      MacTelemetry.capture(.inspectionUsed(action: .select, success: true))
    }
  }

  func focus(_ id: String?) {
    focusedRootId = id
    select(id)
    if let id { expanded.insert(id) }
  }

  func selectSnapshot(_ id: UUID) {
    activeId = id
    resetView()
  }

  /// Step through search hits; Enter / Shift-Enter in the search field.
  func stepSearch(forward: Bool) {
    guard let root = treeRoot else { return }
    if let next = Inspection.step(root.searchMatches(searchQuery), from: selectedId, forward: forward) {
      select(next)
    }
  }

  /// Follow the typing: jump to the first hit unless the selection already is one.
  func searchChanged() {
    let hits = treeRoot?.searchMatches(searchQuery) ?? []
    if let first = hits.first, !hits.contains(where: { $0.id == selectedId }) {
      select(first.id)
    }
  }

  // MARK: Private

  private func fetch(_ backend: any HostBackend, _ deviceKey: String) async throws -> Snapshot {
    let raw = try await backend.request(
      ArgusProtocol.Commands.InspectionCapture.self, .init(deviceKey: deviceKey))
    let capture = Inspection.normalize(raw)
    return Snapshot(capture: capture, image: capture.screenshot.flatMap(NSImage.init(data:)))
  }

  private func add(_ snapshot: Snapshot) {
    snapshots.append(snapshot)
    activeId = snapshot.id
    captureError = nil
    launchPrompt = nil
    resetView()
  }

  private func resetView() {
    selectedId = nil
    focusedRootId = nil
    searchQuery = ""
    reportedSelection = false
    expanded = active.map { [$0.capture.hierarchy.id] } ?? []
  }

  private func clear() {
    snapshots = []
    activeId = nil
    captureError = nil
    launchPrompt = nil
    installedApps = nil
    editError = nil
    resetView()
  }
}
