import SwiftUI

#if canImport(UIKit)
  import UIKit

  public typealias PlatformImage = UIImage
#elseif canImport(AppKit)
  import AppKit

  public typealias PlatformImage = NSImage
#endif

extension PlatformImage {
  /// Transcript images arrive as `data:<mime>;base64,…`.
  public static func fromDataURI(_ uri: String) -> PlatformImage? {
    guard let comma = uri.firstIndex(of: ","),
      let data = Data(base64Encoded: String(uri[uri.index(after: comma)...]))
    else { return nil }
    return PlatformImage(data: data)
  }

  public func jpegData(quality: CGFloat) -> Data? {
    #if canImport(UIKit)
      jpegData(compressionQuality: quality)
    #else
      tiffRepresentation
        .flatMap(NSBitmapImageRep.init(data:))?
        .representation(using: .jpeg, properties: [.compressionFactor: quality])
    #endif
  }
}

extension Image {
  public init(platformImage: PlatformImage) {
    #if canImport(UIKit)
      self.init(uiImage: platformImage)
    #else
      self.init(nsImage: platformImage)
    #endif
  }
}

extension View {
  /// A compact title on iOS; macOS windows have no large-title mode.
  public func inlineNavigationTitle() -> some View {
    #if os(iOS)
      navigationBarTitleDisplayMode(.inline)
    #else
      self
    #endif
  }

  /// A sheet's title. On macOS a sheet's `navigationTitle` lands on the
  /// window it covers and stays there after it closes, so the title is drawn
  /// at the top of the sheet instead.
  public func sheetTitle(_ title: String) -> some View {
    #if os(iOS)
      navigationTitle(title).navigationBarTitleDisplayMode(.inline)
    #else
      safeAreaInset(edge: .top, spacing: 0) {
        Text(title).font(.headline).frame(maxWidth: .infinity).padding(.top, 14)
      }
    #endif
  }

  /// Full screen on the phone, an ordinary sheet where there is no such thing.
  public func coverPresentation<Content: View>(
    isPresented: Binding<Bool>, @ViewBuilder content: @escaping () -> Content
  ) -> some View {
    #if os(iOS)
      fullScreenCover(isPresented: isPresented, content: content)
    #else
      sheet(isPresented: isPresented, content: content)
    #endif
  }
}

extension ToolbarItemPlacement {
  /// The navigation bar's trailing edge on iOS, the toolbar's primary slot on macOS.
  public static var trailingBar: ToolbarItemPlacement {
    #if os(iOS)
      .topBarTrailing
    #else
      .primaryAction
    #endif
  }
}

/// The system clipboard, for text.
@MainActor
public enum Clipboard {
  public static func copy(_ string: String) {
    #if canImport(UIKit)
      UIPasteboard.general.string = string
    #else
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(string, forType: .string)
    #endif
  }
}

/// Drop the keyboard, e.g. before a full-screen image covers the field.
@MainActor
public func dismissKeyboard() {
  #if canImport(UIKit)
    UIApplication.shared.sendAction(
      #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
  #endif
}

extension EnvironmentValues {
  /// Opens Read calls that returned an image, so screenshots show without a tap.
  @Entry public var autoExpandImageReads = false
}
