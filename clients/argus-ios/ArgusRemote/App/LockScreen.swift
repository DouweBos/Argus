import ArgusUI
import SwiftUI

/// The gate shown before biometric unlock.
///
/// Argus is the hundred-eyed watchman, so the locked state is an eye that
/// keeps watch — rings breathing outward while the app waits for you.
struct LockScreen: View {
  @Environment(\.theme) private var theme
  let biometryLabel: String?
  let canAuthenticate: Bool
  let onUnlock: () -> Void

  @State private var entered = false
  @State private var ringPhase = 0.0

  var body: some View {
    ZStack {
      theme.bg.ignoresSafeArea()
      ambience.ignoresSafeArea()

      VStack(spacing: 18) {
        Spacer()
        sigil
        Badge(label: "LOCKED", tone: .muted)
        TitleText("Argus Remote")
        Text("Your agents keep working while you're away. Unlock to look in on them.")
          .font(.system(size: 14))
          .foregroundStyle(theme.textMuted)
          .multilineTextAlignment(.center)
          .padding(.horizontal, 32)
        Spacer()
        Btn(
          label: canAuthenticate ? "Unlock with \(biometryLabel ?? "Face ID")" : "Preparing…",
          action: onUnlock
        )
        .disabled(!canAuthenticate)
        .padding(.horizontal, 24)
        Text("Nothing leaves this phone unencrypted.")
          .font(.system(size: 12))
          .foregroundStyle(theme.textMuted)
          .padding(.bottom, 8)
      }
      .opacity(entered ? 1 : 0)
      .offset(y: entered ? 0 : 14)
      .animation(.easeOut(duration: 0.45), value: entered)
    }
    .onAppear {
      entered = true
      withAnimation(.easeOut(duration: 2.6).repeatForever(autoreverses: false)) {
        ringPhase = 1
      }
    }
  }

  /// Two soft washes, painted behind the content rather than inside its
  /// padding so they reach every edge.
  private var ambience: some View {
    ZStack {
      RadialGradient(
        colors: [theme.accent.opacity(0.16), .clear],
        center: UnitPoint(x: 0.5, y: 0.34), startRadius: 0, endRadius: 320)
      RadialGradient(
        colors: [theme.brandPurple.opacity(0.18), .clear],
        center: UnitPoint(x: 0.18, y: 0.92), startRadius: 0, endRadius: 280)
    }
  }

  private var sigil: some View {
    ZStack {
      ForEach(0..<2, id: \.self) { index in
        let offset = Double(index) * 0.5
        let local = (ringPhase + offset).truncatingRemainder(dividingBy: 1)
        Circle()
          .stroke(theme.accent.opacity((1 - local) * 0.5), lineWidth: 1)
          .frame(width: 168 * (0.62 + local * 0.43))
      }
      Circle().fill(theme.accentSoft).frame(width: 96, height: 96)
      Image(systemName: Icon.eye)
        .font(.system(size: 34, weight: .light))
        .foregroundStyle(theme.accent)
    }
    .frame(width: 168, height: 168)
  }
}
