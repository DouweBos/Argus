import ArgusCore
import ArgusUI
import SwiftUI

/// One conversation in a teammate's side list: what it's about, where it
/// started and when it was last open, like a message list.
struct TeammateThreadRow: View {
  @Environment(\.theme) private var theme
  let thread: ArgusProtocol.TeammateThread
  let selected: Bool
  let action: () -> Void
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      VStack(alignment: .leading, spacing: 3) {
        Text(thread.title.isEmpty ? "New conversation" : thread.title)
          .font(.scaled(size: 13))
          .foregroundStyle(selected ? theme.text : theme.text.opacity(0.85))
          .lineLimit(2)
          .multilineTextAlignment(.leading)
        HStack(spacing: 4) {
          if let icon = thread.surface.icon {
            Image(systemName: icon).font(.scaled(size: 10))
          }
          Text(meta).lineLimit(1)
        }
        .font(.scaled(.caption))
        .foregroundStyle(theme.textSecondary)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 10).padding(.vertical, 7)
      .background {
        if selected || hovering {
          RoundedRectangle(cornerRadius: 8).fill(selected ? theme.selection : theme.bgHover.opacity(0.6))
        }
      }
      .contentShape(.rect(cornerRadius: 8))
    }
    .buttonStyle(.argusPlain)
    .onHover { hovering = $0 }
    .accessibilityAddTraits(selected ? .isSelected : [])
  }

  private var meta: String {
    let when = Labels.timeAgo(thread.lastOpenedAt)
    return thread.surface.label.map { "\($0) · \(when)" } ?? when
  }
}

/// What an empty conversation shows instead of "Nothing yet": the teammate
/// itself, saying hello.
struct TeammateGreeting: View {
  @Environment(\.theme) private var theme
  let teammate: TeammatesStore.Teammate

  var body: some View {
    VStack(spacing: 10) {
      TeammateAvatar(teammate: teammate, size: 64)
      VStack(spacing: 2) {
        Text(teammate.name).font(.scaled(.title3)).fontWeight(.semibold)
        Text("@\(teammate.handle)").font(.scaled(.callout)).foregroundStyle(.secondary)
      }
      if !teammate.tagline.isEmpty {
        Text(teammate.tagline).font(.scaled(.callout)).foregroundStyle(theme.textSecondary)
      }
      Text(
        teammate.enabled
          ? "Ask anything. It remembers what its duties found and what you told it before."
          : "Paused, so its duties won't run — but you can still talk to it."
      )
      .font(.scaled(.footnote))
      .foregroundStyle(.secondary)
      .multilineTextAlignment(.center)
      .frame(maxWidth: 320)
      .padding(.top, 4)
    }
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
