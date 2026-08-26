import ExpoModulesCore

/// Hands the push decryption key to the notification service extension.
///
/// The extension is a separate process, so it can't read the app's keychain or
/// AsyncStorage. An App Group container is the only thing both can see.
public class ArgusPushModule: Module {
  private static let appGroup = "group.dev.houwert.argus.remote"
  private static let pushKeyDefault = "argus.pushKey"

  public func definition() -> ModuleDefinition {
    Name("ArgusPush")

    Function("setPushKey") { (base64Key: String) in
      UserDefaults(suiteName: Self.appGroup)?
        .set(base64Key, forKey: Self.pushKeyDefault)
    }

    Function("clearPushKey") {
      UserDefaults(suiteName: Self.appGroup)?
        .removeObject(forKey: Self.pushKeyDefault)
    }
  }
}
