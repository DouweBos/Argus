import ArgusUI
import SwiftUI

/// The app wasn't launched with the in-process library: restart the running
/// one with it, or pick an installed app — `InspectionLauncher`.
struct InspectionLauncherView: View {
  @Environment(\.theme) private var theme
  let model: InspectionModel
  let prompt: InspectionModel.LaunchPrompt

  @State private var filter = ""

  var body: some View {
    VStack(spacing: 10) {
      Image(systemName: "square.3.layers.3d")
        .font(.scaled(size: 22))
        .foregroundStyle(theme.accent)
        .frame(width: 44, height: 44)
        .background(theme.accentSoft, in: RoundedRectangle(cornerRadius: theme.radiusSmall))
      if let reason = prompt.unavailableReason {
        title("Can't inspect this app")
        hint(reason)
        if let bundleId = prompt.foregroundApp {
          Text(bundleId).font(.scaled(.caption).monospaced()).foregroundStyle(theme.textMuted)
        }
      } else if !prompt.isSpringboard, let bundleId = prompt.foregroundApp {
        restart(bundleId)
      } else {
        picker
      }
    }
    .padding(20)
    .frame(maxWidth: 360)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(theme.bg)
  }

  private func restart(_ bundleId: String) -> some View {
    let name = model.installedApps?.first { $0.bundleId == bundleId }?.name ?? bundleId
    return VStack(spacing: 10) {
      title("\(name) is running without inspection")
      hint("Restart it with the inspection library injected to read its native view tree — real classes, colors and fonts.")
      Button(model.launching ? "Restarting…" : "Restart with inspection") {
        Task { await model.relaunch(bundleId: bundleId) }
      }
      .buttonStyle(.borderedProminent)
      .disabled(model.launching)
      Text(bundleId).font(.scaled(.caption).monospaced()).foregroundStyle(theme.textMuted)
    }
  }

  @ViewBuilder
  private var picker: some View {
    title("Pick an app to inspect")
    hint("Nothing is running to inspect. Launching an app here starts it with the inspection library injected.")
    if let apps = model.installedApps {
      if apps.isEmpty {
        hint("No user apps are installed.")
      } else {
        if apps.count > 6 {
          TextField("Filter apps…", text: $filter).textFieldStyle(.roundedBorder)
        }
        ScrollView {
          VStack(spacing: 0) {
            ForEach(filtered(apps), id: \.bundleId) { app in
              appRow(app)
              Divider()
            }
          }
        }
        .frame(maxHeight: 280)
        .overlay(RoundedRectangle(cornerRadius: theme.radiusSmall).strokeBorder(theme.border))
        if model.launching {
          HStack(spacing: 6) {
            ProgressView().controlSize(.small)
            hint("Launching with inspection…")
          }
        }
      }
    } else {
      HStack(spacing: 6) {
        ProgressView().controlSize(.small)
        hint("Loading installed apps…")
      }
    }
  }

  private func appRow(_ app: ArgusProtocol.InstalledApp) -> some View {
    Button {
      Task { await model.relaunch(bundleId: app.bundleId) }
    } label: {
      HStack {
        VStack(alignment: .leading, spacing: 1) {
          Text(app.name).foregroundStyle(theme.text)
          Text(app.bundleId).font(.scaled(.caption).monospaced()).foregroundStyle(theme.textMuted)
        }
        Spacer(minLength: 0)
        Image(systemName: Icon.chevronRight).foregroundStyle(theme.textMuted)
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 6)
      .contentShape(Rectangle())
    }
    .buttonStyle(.argusPlain)
    .disabled(model.launching)
  }

  private func filtered(_ apps: [ArgusProtocol.InstalledApp]) -> [ArgusProtocol.InstalledApp] {
    let q = filter.trimmingCharacters(in: .whitespaces).lowercased()
    guard !q.isEmpty else { return apps }
    return apps.filter { $0.name.lowercased().contains(q) || $0.bundleId.lowercased().contains(q) }
  }

  private func title(_ text: String) -> some View {
    Text(text).font(.scaled(.headline)).foregroundStyle(theme.text).multilineTextAlignment(.center)
  }

  private func hint(_ text: String) -> some View {
    Text(text).font(.scaled(.callout)).foregroundStyle(theme.textMuted).multilineTextAlignment(.center)
  }
}
