import AppKit
import ArgusUI
import GroveKit
import SwiftUI

/// Sheets and confirmations for git actions, on the panel's window. Context
/// menus and toolbar items have no view that outlives them to hang a `.sheet` on.
@MainActor
enum GitDialogs {
  /// The window to present on: a background dev build has no key window.
  private static var window: NSWindow? {
    let key = NSApp.keyWindow.map { $0.sheetParent ?? $0 }
    return key ?? NSApp.mainWindow
      ?? NSApp.windows.first { $0.isVisible && $0.sheetParent == nil && $0.styleMask.contains(.titled) }
  }

  /// Presents `content` as a sheet; it calls `dismiss` when done.
  static func sheet<Content: View>(
    theme: Theme, @ViewBuilder _ content: (_ dismiss: @escaping () -> Void) -> Content
  ) {
    guard let window else { return }
    let box = SheetBox()
    let root = content { box.close() }
      .environment(\.theme, theme)
      .frame(width: 440)
    let controller = NSHostingController(rootView: root)
    controller.sizingOptions = .preferredContentSize
    let sheet = NSWindow(contentViewController: controller)
    box.sheet = sheet
    window.beginSheet(sheet)
  }

  /// Asks before a destructive or hard-to-undo action.
  static func confirm(_ title: String, message: String, action: String, destructive: Bool = false) async -> Bool {
    await choose(title, message: message, buttons: [action], destructive: destructive) == 0
  }

  /// One of `buttons` (by index), or nil for Cancel.
  static func choose(_ title: String, message: String, buttons: [String], destructive: Bool = false) async -> Int? {
    let alert = NSAlert()
    alert.messageText = title
    alert.informativeText = message
    for (index, name) in buttons.enumerated() {
      let button = alert.addButton(withTitle: name)
      button.hasDestructiveAction = destructive && index == 0
    }
    alert.addButton(withTitle: "Cancel")
    let response: NSApplication.ModalResponse
    if let window {
      response = await alert.beginSheetModal(for: window)
    } else {
      response = alert.runModal()
    }
    let index = response.rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
    return buttons.indices.contains(index) ? index : nil
  }
}

@MainActor
private final class SheetBox {
  var sheet: NSWindow?

  func close() {
    guard let sheet else { return }
    sheet.sheetParent?.endSheet(sheet)
    self.sheet = nil
  }
}

/// The frame every git sheet shares: title, content, Cancel and the primary button.
struct GitSheetLayout<Content: View>: View {
  let title: String
  var primary = "OK"
  var canSubmit = true
  let cancel: () -> Void
  let submit: () -> Void
  @ViewBuilder let content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text(title).font(.headline)
      content
      HStack {
        Spacer()
        Button("Cancel", action: cancel).keyboardShortcut(.cancelAction)
        Button(primary, action: submit)
          .keyboardShortcut(.defaultAction)
          .disabled(!canSubmit)
      }
    }
    .padding(20)
  }
}

/// A single name (branch, remote, URL…) with an optional checkbox.
struct GitNameSheet: View {
  let title: String
  let label: String
  var primary = "OK"
  var initial = ""
  var toggle: String?
  var toggleInitial = true
  var validate: (String) -> Bool = { !$0.isEmpty }
  let dismiss: () -> Void
  let submit: (_ name: String, _ toggled: Bool) -> Void
  @State private var name = ""
  @State private var toggled = true

  private var trimmed: String { name.trimmingCharacters(in: .whitespaces) }

  var body: some View {
    GitSheetLayout(
      title: title, primary: primary, canSubmit: validate(trimmed), cancel: dismiss,
      submit: {
        dismiss()
        submit(trimmed, toggled)
      }
    ) {
      TextField(label, text: $name).textFieldStyle(.roundedBorder).initialFocus()
      if let toggle { Toggle(toggle, isOn: $toggled) }
    }
    .onAppear {
      name = initial
      toggled = toggleInitial
    }
  }
}

extension GitNameSheet {
  /// `git check-ref-format`'s common rules, for inline validation.
  static func isValidRef(_ name: String) -> Bool { ReflogViewModel.isValidBranchName(name) }
}

/// Focuses a sheet's first field once it's on screen.
private struct InitialFocus: ViewModifier {
  @FocusState private var focused: Bool

  func body(content: Content) -> some View {
    content
      .focused($focused)
      .task { focused = true }
  }
}

extension View {
  func initialFocus() -> some View { modifier(InitialFocus()) }
}
