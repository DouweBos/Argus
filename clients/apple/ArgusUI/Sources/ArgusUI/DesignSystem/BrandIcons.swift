import SwiftUI

/// Third-party marks for sign-in buttons. Templates, so they take the button's colour.
public enum BrandIcon {
  /// GitHub's mark (Octicons `mark-github`, MIT).
  public static var github: Image { Image("github-mark", bundle: .module).renderingMode(.template) }
}
