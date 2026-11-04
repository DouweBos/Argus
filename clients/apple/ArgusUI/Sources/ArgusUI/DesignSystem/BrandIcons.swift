import SwiftUI

/// Third-party marks (Octicons, MIT). Templates, so they take the surrounding colour.
public enum BrandIcon {
  /// GitHub's mark, for sign-in buttons.
  public static var github: Image { Image("github-mark", bundle: .module).renderingMode(.template) }
}
