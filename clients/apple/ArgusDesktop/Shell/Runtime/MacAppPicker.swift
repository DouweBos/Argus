import AppKit
import ArgusCore
import ArgusUI
import SwiftUI

/// The windows open on this Mac, one row each with its app's icon.
struct MacAppPicker: View {
  @Environment(\.theme) private var theme
  let apps: MacApps
  let selection: String?
  let pick: (MacAppWindow) -> Void

  var body: some View {
    if apps.windows.isEmpty {
      EmptyState(
        icon: "macwindow", title: "No windows open",
        body: "Open the app you want to watch. Its windows show up here.")
      {
        Button("Refresh") { apps.refresh() }
      }
    } else {
      ScrollView {
        VStack(alignment: .leading, spacing: 8) {
          HStack {
            SectionLabel("Windows on this Mac", count: apps.windows.count)
            Spacer()
            Button("Refresh", systemImage: "arrow.clockwise") { apps.refresh() }
              .labelStyle(.iconOnly)
              .buttonStyle(.argusBorderless)
              .help("Refresh")
          }
          VStack(spacing: 0) {
            ForEach(apps.windows) { window in
              if window.id != apps.windows.first?.id { Divider() }
              MacAppWindowRow(window: window, picked: window.target.key == selection) { pick(window) }
            }
          }
          .panel()
          Text("Argus itself is never listed. Minimised windows and ones on another Space show up once they're back on screen.")
            .font(.scaled(.caption))
            .foregroundStyle(theme.textMuted)
        }
        .padding(theme.space)
      }
    }
  }
}

private struct MacAppWindowRow: View {
  @Environment(\.theme) private var theme
  let window: MacAppWindow
  let picked: Bool
  let pick: () -> Void

  var body: some View {
    Button(action: pick) {
      HStack(spacing: 10) {
        icon.frame(width: 28, height: 28)
        VStack(alignment: .leading, spacing: 2) {
          Text(window.appName).font(.scaled(size: 13, weight: .medium)).foregroundStyle(theme.text)
          Text(window.title.isEmpty ? "Untitled window" : window.title)
            .font(.scaled(size: 11))
            .foregroundStyle(theme.textMuted)
        }
        .lineLimit(1)
        Spacer(minLength: 8)
        if picked {
          Image(systemName: "checkmark").foregroundStyle(theme.accent)
        } else {
          Text("Mirror").font(.scaled(size: 12, weight: .medium)).foregroundStyle(theme.accent)
        }
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
      .contentShape(.rect)
    }
    .buttonStyle(.argusPlain)
    .accessibilityLabel("Mirror \(window.appName), \(window.title)")
  }

  @ViewBuilder
  private var icon: some View {
    if let image = MacApps.icon(window) {
      Image(nsImage: image).resizable().interpolation(.high)
    } else {
      Image(systemName: "app.dashed").font(.scaled(size: 20)).foregroundStyle(theme.textMuted)
    }
  }
}

/// What macOS has to allow first, each with the button that asks for it.
struct MacAppPermissionsView: View {
  @Environment(\.theme) private var theme
  let apps: MacApps

  var body: some View {
    ScrollView {
      VStack(spacing: 14) {
        Image(systemName: "macwindow.badge.plus")
          .font(.scaled(size: 36, weight: .thin))
          .foregroundStyle(theme.textMuted)
        Text("Let Argus see and use your apps").font(.scaled(size: 15, weight: .semibold))
        Text(
          "To mirror an app's window here, macOS needs your permission. The picture stays on this Mac: it isn't recorded, saved or sent anywhere."
        )
        .font(.scaled(size: 12))
        .foregroundStyle(theme.textMuted)
        .multilineTextAlignment(.center)
        VStack(spacing: 0) {
          MacAppGrantRow(
            grant: .screenRecording, granted: apps.permissions.screenRecording, title: "Screen Recording",
            detail: "Required. Shows the window you pick. macOS may ask you to quit and reopen Argus after allowing it."
          ) { apps.request(.screenRecording) }
          Divider()
          MacAppGrantRow(
            grant: .accessibility, granted: apps.permissions.accessibility, title: "Accessibility",
            detail: "Optional. Lets your clicks, scrolling and typing in the mirror reach the app. Without it the mirror only watches."
          ) { apps.request(.accessibility) }
        }
        .panel()
        Button("Open Privacy & Security") {
          apps.openSettings(apps.permissions.blocking ?? .accessibility)
        }
        .buttonStyle(.argusBorderless)
        .foregroundStyle(theme.accent)
      }
      .frame(maxWidth: 420)
      .padding(theme.space * 2)
      .frame(maxWidth: .infinity)
    }
  }
}

private struct MacAppGrantRow: View {
  @Environment(\.theme) private var theme
  let grant: MacAppPermissions.Grant
  let granted: Bool
  let title: String
  let detail: String
  let request: () -> Void

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: grant == .screenRecording ? "rectangle.dashed.badge.record" : "accessibility")
        .font(.scaled(size: 16))
        .foregroundStyle(granted ? theme.success : theme.textMuted)
        .frame(width: 22)
      VStack(alignment: .leading, spacing: 3) {
        Text(title).font(.scaled(size: 13, weight: .medium))
        Text(detail).font(.scaled(size: 11)).foregroundStyle(theme.textMuted)
          .fixedSize(horizontal: false, vertical: true)
      }
      Spacer(minLength: 8)
      if granted {
        Label("Allowed", systemImage: "checkmark.circle.fill")
          .font(.scaled(size: 12))
          .foregroundStyle(theme.success)
      } else {
        Button("Allow", action: request)
          .buttonStyle(.borderedProminent)
          .controlSize(.small)
      }
    }
    .padding(12)
  }
}

/// Over a mirror that can only watch: why, and the button that fixes it.
struct MacAppViewOnlyBanner: View {
  @Environment(\.theme) private var theme
  let appName: String
  let allow: () -> Void

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "eye").font(.scaled(size: 11)).foregroundStyle(theme.warning)
      Text("View only. Allow Accessibility to click and type in \(appName).")
        .font(.scaled(size: 12, weight: .medium))
        .foregroundStyle(theme.text)
        .lineLimit(2)
      Button("Allow", action: allow)
        .buttonStyle(.borderedProminent)
        .controlSize(.small)
    }
    .padding(.leading, 12).padding(.trailing, 6).padding(.vertical, 6)
    .background(theme.bgSecondary, in: .capsule)
    .overlay { Capsule().strokeBorder(theme.border, lineWidth: 1) }
    .padding(12)
  }
}
