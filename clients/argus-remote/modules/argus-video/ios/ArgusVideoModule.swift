import ExpoModulesCore

/// Bridges the device-screen stream to a native H.264 surface. Frames are
/// decrypted in JS, so they're passed in as typed arrays rather than pulled
/// from a URL.
public class ArgusVideoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArgusVideo")

    View(ArgusVideoView.self) {
      Events("onFirstFrame")

      AsyncFunction("configure") {
        (view: ArgusVideoView, codec: String, width: Int, height: Int, description: Data) in
        try view.configure(codec: codec, description: [UInt8](description))
      }

      AsyncFunction("enqueue") {
        (view: ArgusVideoView, data: Data, isKeyFrame: Bool, timestamp: Double) in
        try view.enqueue(data: data, isKeyFrame: isKeyFrame, timestamp: timestamp)
      }
    }
  }
}
