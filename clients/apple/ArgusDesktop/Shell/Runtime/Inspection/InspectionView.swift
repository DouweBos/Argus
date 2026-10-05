import ArgusUI
import SwiftUI

/// The device UI inspector: the captured screen on top, the hierarchy and the
/// selected node's metadata below it — the renderer's `InspectionPanel` and
/// the metadata panel it swaps in for the log, stacked for a narrow column.
struct InspectionView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var store
  let deviceKey: String?

  @State private var model = InspectionModel()

  var body: some View {
    VStack(spacing: 0) {
      header
      Divider()
      if !model.breadcrumbs.isEmpty {
        breadcrumbs
        Divider()
      }
      if let error = model.captureError {
        Label(error, systemImage: Icon.warning)
          .font(.scaled(.caption))
          .foregroundStyle(theme.error)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 10)
          .padding(.vertical, 6)
          .background(theme.errorSoft)
      }
      content.frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .background(theme.bg)
    .task(id: "\(deviceKey ?? "")|\(store.connection == .ready)") {
      model.attach(backend: store.backend, deviceKey: deviceKey)
    }
  }

  @ViewBuilder
  private var content: some View {
    if let snapshot = model.active, let root = model.treeRoot {
      ResizableVSplit(key: "inspection.panes", topMin: 180, bottomMin: 200, bottomIdeal: 440, showsBottom: true) {
        InspectionOverlay(model: model, snapshot: snapshot, root: root)
      } bottom: {
        ResizableVSplit(key: "inspection.metadata", topMin: 100, bottomMin: 100, bottomIdeal: 240, showsBottom: true) {
          InspectionTreeView(model: model, root: root)
        } bottom: {
          InspectionMetadataView(model: model)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else if let prompt = model.launchPrompt {
      InspectionLauncherView(model: model, prompt: prompt)
    } else if model.capturing {
      ContentUnavailableView {
        ProgressView()
      } description: {
        Text("Reading the live view and layer tree from inside the running app.")
      }
    } else {
      ContentUnavailableView {
        Label("Inspect a live screen", systemImage: "square.3.layers.3d")
      } description: {
        Text(
          deviceKey == nil
            ? "Pick an iOS simulator, boot it in Simulate, then come back and press Inspect."
            : "Read the running app's native view tree: real classes, colors, fonts and text."
        )
      } actions: {
        Button("Inspect", action: inspect).disabled(deviceKey == nil)
      }
    }
  }

  private var header: some View {
    HStack(spacing: 8) {
      Button(action: inspect) {
        Label(inspectLabel, systemImage: model.active == nil ? Icon.search : Icon.refresh)
      }
      .disabled(model.capturing || model.launching || deviceKey == nil)
      if model.snapshots.count > 1 {
        Picker("Snapshot", selection: snapshotBinding) {
          ForEach(Array(model.snapshots.enumerated()), id: \.element.id) { index, snapshot in
            Text("Snapshot \(index + 1) · \(Self.time(snapshot.capture.capturedAt))")
              .tag(snapshot.id)
          }
        }
        .labelsHidden()
        .fixedSize()
      }
      Spacer(minLength: 0)
      if let capture = model.active?.capture {
        Text(
          "\(capture.device.platform.uppercased()) · \(Inspection.format(capture.device.width)) × \(Inspection.format(capture.device.height)) · \(capture.nodeCount) nodes"
        )
        .font(.scaled(.caption).monospacedDigit())
        .foregroundStyle(theme.textMuted)
        .lineLimit(1)
      }
    }
    .controlSize(.small)
    .padding(.horizontal, 10)
    .frame(height: 32)
  }

  private var breadcrumbs: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 4) {
        Button {
          model.focus(nil)
        } label: {
          Label("Full tree", systemImage: Icon.close)
        }
        .help("Exit focused view")
        ForEach(model.breadcrumbs) { node in
          Image(systemName: Icon.chevronRight)
            .font(.scaled(size: 8, weight: .semibold))
            .foregroundStyle(theme.textMuted)
          let focused = node.id == model.focusedRootId
          Button {
            if focused { model.select(node.id) } else { model.focus(node.id) }
          } label: {
            Text(node.className).fontWeight(focused ? .semibold : .regular)
          }
          .foregroundStyle(focused ? theme.accent : theme.text)
        }
      }
      .buttonStyle(.borderless)
      .font(.scaled(size: 11, design: .monospaced))
      .padding(.horizontal, 10)
    }
    .frame(height: 26)
  }

  private var inspectLabel: String {
    if model.capturing { return model.active == nil ? "Inspecting…" : "Refreshing…" }
    return model.active == nil ? "Inspect" : "Refresh"
  }

  private var snapshotBinding: Binding<UUID> {
    Binding(
      get: { model.active?.id ?? UUID() },
      set: { model.selectSnapshot($0) })
  }

  private func inspect() {
    Task { await model.capture() }
  }

  /// `HH:mm:ss` from the ISO timestamp, as the renderer shows it.
  private static func time(_ iso: String) -> String {
    let chars = Array(iso)
    return chars.count >= 19 ? String(chars[11..<19]) : iso
  }
}
