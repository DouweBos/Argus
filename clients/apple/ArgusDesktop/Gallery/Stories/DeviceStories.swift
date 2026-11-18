#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// `/devices`: running, stopped, remote and browser devices; the device preview's Select Element.
  enum DeviceStories {
    static var all: [GalleryStory] {
      [
        GalleryStory(
          "devices/list", size: CGSize(width: 1100, height: 520), chrome: true, fixtures: GalleryFixtures.deviceList
        ) {
          DevicesScreen()
        },
        GalleryStory("devices/preview/picking", size: CGSize(width: 420, height: 640)) {
          DevicePickStory(picker: .preview(capture: PickFixture.capture, hovered: "save"))
        },
        GalleryStory("devices/preview/reading", size: CGSize(width: 420, height: 640)) {
          DevicePickStory(picker: .preview(capture: nil, hovered: nil))
        },
      ]
    }
  }

  /// The panel's device toolbar over a stand-in for the stream, drawn from the capture.
  private struct DevicePickStory: View {
    @Environment(\.theme) private var theme
    let picker: DeviceElementPicker

    var body: some View {
      VStack(spacing: 0) {
        RuntimeDeviceActions(platform: .ios, deviceId: "gallery-sim", sessionId: "gallery", picker: picker)
        Divider()
        GeometryReader { proxy in
          let geometry = DeviceGeometry(coded: PickFixture.screen, stage: proxy.size)
          ZStack {
            theme.bg
            screen(geometry.pictureRect)
            DevicePickOverlay(picker: picker, geometry: geometry)
          }
        }
      }
      .background(theme.bg)
    }

    private func screen(_ rect: CGRect) -> some View {
      let scale = rect.width / PickFixture.screen.width
      return ZStack(alignment: .topLeading) {
        theme.bgSecondary
        ForEach(PickFixture.capture.hierarchy.flattened().dropFirst(), id: \.id) { node in
          let r = node.rect
          Group {
            if let text = node.text {
              Text(text).font(.system(size: 15 * scale, weight: node.className == "Button" ? .semibold : .regular))
                .foregroundStyle(node.className == "Button" ? theme.onAccent : theme.text)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: node.className == "Button" ? .center : .leading)
                .background(node.className == "Button" ? theme.accent : .clear, in: .rect(cornerRadius: 10 * scale))
            } else {
              RoundedRectangle(cornerRadius: 10 * scale).fill(theme.bg)
            }
          }
          .frame(width: r.w * scale, height: r.h * scale)
          .offset(x: r.x * scale, y: r.y * scale)
        }
      }
      .frame(width: rect.width, height: rect.height)
      .clipShape(.rect(cornerRadius: 24 * scale))
      .position(x: rect.midX, y: rect.midY)
    }
  }

  /// A sign-in form as `device_element_capture` would read it.
  private enum PickFixture {
    static let screen = CGSize(width: 390, height: 844)

    static let capture: Inspection.Capture = {
      func node(_ id: String, _ cls: String, _ x: Double, _ y: Double, _ w: Double, _ h: Double, text: String? = nil)
        -> Inspection.Node
      {
        var n = Inspection.Node(
          id: id, className: cls, frame: .init(x: x, y: y, w: w, h: h), absFrame: .init(x: x, y: y, w: w, h: h),
          depth: 1)
        n.text = text
        return n
      }
      var save = node("save", "Button", 24, 520, 342, 50, text: "Sign In")
      save.accessibilityIdentifier = "btn_sign_in"
      let root = Inspection.Node(
        id: "window", className: "Application", frame: .init(x: 0, y: 0, w: 390, h: 844), depth: 0,
        children: [
          node("title", "StaticText", 24, 110, 342, 40, text: "Welcome back"),
          node("email-box", "TextField", 24, 220, 342, 52),
          node("email", "StaticText", 40, 220, 300, 52, text: "you@example.com"),
          node("password-box", "SecureTextField", 24, 290, 342, 52),
          node("password", "StaticText", 40, 290, 300, 52, text: "••••••••"),
          node("forgot", "StaticText", 24, 360, 342, 30, text: "Forgot password?"),
          save,
        ])
      return Inspection.Capture(
        capturedAt: "", device: .init(deviceId: "gallery-sim", platform: "ios", width: 390, height: 844),
        hierarchy: root, nodeCount: 8, screenshot: nil)
    }()
  }
#endif
