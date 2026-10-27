import SwiftUI

/// The Apple TV clickpad, mirroring the desktop's remote. A TV has no
/// touchscreen, so the stream is a picture and this is the only way to drive it.
public struct TVRemoteView: View {
  @Environment(\.theme) private var theme

  /// Button ids as the host names them.
  let press: (String) -> Void
  /// Android TV has no Menu/Play-Pause pair; it gets Back instead.
  let isAndroid: Bool

  @State private var active: String?

  private static let padSize: CGFloat = 220

  public init(press: @escaping (String) -> Void, isAndroid: Bool) {
    self.press = press
    self.isAndroid = isAndroid
  }

  public var body: some View {
    VStack(spacing: 16) {
      clickpad
      HStack(spacing: 12) {
        if isAndroid {
          pill("Back", icon: Icon.androidBack, id: "back")
          pill("Home", icon: Icon.home, id: "home")
        } else {
          pill("Menu", icon: Icon.menu, id: "menu")
          pill("Play/Pause", icon: Icon.playPause, id: "playpause")
          pill("Home", icon: Icon.home, id: "home")
        }
      }
    }
    .padding(theme.space)
  }

  private var clickpad: some View {
    ZStack {
      Circle().fill(theme.bgSecondary)
      Circle().strokeBorder(theme.border, lineWidth: 1)
      arrow(Icon.chevronUp, id: "up").offset(y: -Self.padSize * 0.33)
      arrow(Icon.chevronDown, id: "down").offset(y: Self.padSize * 0.33)
      arrow(Icon.chevronLeft, id: "left").offset(x: -Self.padSize * 0.33)
      arrow(Icon.chevronRight, id: "right").offset(x: Self.padSize * 0.33)
      Button { fire("select") } label: {
        Circle()
          .fill(active == "select" ? theme.accentSoft : theme.bgTertiary)
          .overlay(Circle().strokeBorder(theme.border, lineWidth: 1))
          .frame(width: Self.padSize * 0.4, height: Self.padSize * 0.4)
      }
      .buttonStyle(.argusPlain)
      .accessibilityLabel("Select")
    }
    .frame(width: Self.padSize, height: Self.padSize)
  }

  private func arrow(_ icon: String, id: String) -> some View {
    Button { fire(id) } label: {
      Image(systemName: icon)
        .font(.scaled(size: 20, weight: .semibold))
        .foregroundStyle(active == id ? theme.accent : theme.textSecondary)
        .frame(width: 52, height: 52)
        .contentShape(Rectangle())
    }
    .buttonStyle(.argusPlain)
    .accessibilityLabel(id.capitalized)
  }

  private func pill(_ label: String, icon: String, id: String) -> some View {
    Button { fire(id) } label: {
      Label(label, systemImage: icon)
        .labelStyle(.iconOnly)
        .font(.scaled(size: 15))
        .frame(width: 56, height: 36)
    }
    .buttonStyle(.bordered)
    .tint(active == id ? theme.accent : nil)
    .accessibilityLabel(label)
  }

  /// Flash the pressed control: the stream is a second or so behind, so
  /// without it a press looks like it went nowhere.
  private func fire(_ id: String) {
    active = id
    press(id)
    Task { @MainActor in
      try? await Task.sleep(for: .milliseconds(150))
      if active == id { active = nil }
    }
  }
}
