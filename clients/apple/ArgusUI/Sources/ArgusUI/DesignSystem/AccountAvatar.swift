import ArgusKit
import SwiftUI

/// The signed-in person's picture, or their initials on a tinted circle. A
/// person glyph stands in when signed out or the name isn't known yet.
public struct AccountAvatar: View {
  @Environment(\.theme) private var theme
  let profile: AccountProfile?
  let size: CGFloat

  public init(profile: AccountProfile?, size: CGFloat = 44) {
    self.profile = profile
    self.size = size
  }

  public var body: some View {
    Group {
      if let url = profile?.imageURL {
        AsyncImage(url: url) { phase in
          if let image = phase.image {
            image.resizable().scaledToFill()
          } else {
            placeholder
          }
        }
      } else {
        placeholder
      }
    }
    .frame(width: size, height: size)
    .clipShape(Circle())
    .accessibilityHidden(true)
  }

  private var placeholder: some View {
    ZStack {
      Circle().fill(theme.accentSoft)
      if let initials = profile?.initials, !initials.isEmpty {
        Text(initials)
          .font(.system(size: size * 0.4, weight: .semibold))
          .foregroundStyle(theme.accent)
      } else {
        Image(systemName: "person.fill")
          .font(.system(size: size * 0.45))
          .foregroundStyle(theme.accent)
      }
    }
  }
}
