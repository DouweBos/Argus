import AppKit
import UniformTypeIdentifiers

/// The open and save panels behind the kit's Create Patch and Apply Patch.
@MainActor
enum PatchPanels {
  /// For the kit's Apply Patch.
  static func chooseFile() async -> URL? {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = false
    panel.canChooseDirectories = false
    panel.message = "Choose a patch to apply to the working tree"
    return await withCheckedContinuation { done in
      present(panel) { response in done.resume(returning: response == .OK ? DevPanelPath.url ?? panel.url : nil) }
    }
  }

  /// For the kit's Create Patch.
  static func chooseDestination(name: String, message: String) async -> URL? {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = name
    panel.message = message
    panel.allowedContentTypes = [UTType(filenameExtension: "patch") ?? .plainText]
    return await withCheckedContinuation { done in
      present(panel) { response in done.resume(returning: response == .OK ? DevPanelPath.url ?? panel.url : nil) }
    }
  }

  private static func present(_ panel: NSSavePanel, then finish: @escaping (NSApplication.ModalResponse) -> Void) {
    #if DEBUG
      // A driven dev build can't click through a panel; it names the file instead.
      if let path = ProcessInfo.processInfo.environment["ARGUS_DEV_PANEL_PATH"] {
        panel.directoryURL = URL(fileURLWithPath: path).deletingLastPathComponent()
        panel.nameFieldStringValue = URL(fileURLWithPath: path).lastPathComponent
        DevPanelPath.url = URL(fileURLWithPath: path)
        return finish(.OK)
      }
    #endif
    if let window = NSApp.keyWindow {
      panel.beginSheetModal(for: window, completionHandler: finish)
    } else {
      finish(panel.runModal())
    }
  }
}

/// The file a driven dev build named in place of a panel; always nil in release.
@MainActor
enum DevPanelPath {
  #if DEBUG
    static var url: URL?
  #else
    static let url: URL? = nil
  #endif
}
