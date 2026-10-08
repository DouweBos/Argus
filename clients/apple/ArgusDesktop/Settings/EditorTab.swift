import AppKit
import ArgusSyntax
import SwiftUI

/// Settings → Editor: the code view's font and indentation, where chat file
/// links open, and which language servers run. `.editorconfig` wins over
/// indentation wherever a project has one.
struct EditorTab: View {
  @Environment(DesktopModel.self) private var model
  @State private var prefs = AppPreferences.shared
  @State private var fonts: [String] = []

  var body: some View {
    Form {
      Section {
        Picker("Font", selection: $prefs.editorFontName.tracked(.editorFont)) {
          Text("SF Mono").tag("")
          Divider()
          ForEach(fonts, id: \.self) { Text($0).tag($0) }
        }
        Stepper(value: $prefs.editorFontSize.tracked(.editorFontSize), in: 8...32, step: 1) {
          LabeledContent("Font size", value: "\(Int(prefs.editorFontSize)) pt")
        }
        Stepper(value: $prefs.editorTabWidth.tracked(.editorTabWidth), in: 1...16) {
          LabeledContent("Tab width", value: "\(prefs.editorTabWidth)")
        }
        Toggle("Insert spaces for tabs", isOn: $prefs.editorInsertSpaces.tracked(.editorInsertSpaces))
        Toggle("Wrap lines", isOn: $prefs.editorWrapLines.tracked(.editorWrapLines))
        Toggle("Show invisibles", isOn: $prefs.editorShowInvisibles.tracked(.editorShowInvisibles))
      } header: {
        Text("Code view")
      } footer: {
        SettingsCaption("A project's .editorconfig overrides tab width and spaces for the files it covers.")
      }
      Section {
        Picker("Open file links in", selection: $prefs.openFileLinksIn.tracked(.openFileLinksIn)) {
          ForEach(FileLinkTarget.allCases, id: \.self) { Text($0.title).tag($0) }
        }
        .pickerStyle(.segmented)
      } footer: {
        SettingsCaption(
          "Argus opens a file an agent mentions in the session's code view, at the line. Files outside the worktree always open in their default app.")
      }
      Section {
        Toggle("Language servers", isOn: $prefs.languageServersEnabled.tracked(.languageServers))
        ForEach(EditorLanguageServers.languages, id: \.self) { language in
          Toggle(language.displayName, isOn: serverBinding(language))
            .disabled(!prefs.languageServersEnabled)
        }
      } header: {
        Text("Language servers")
      } footer: {
        SettingsCaption("Diagnostics, hover, go to definition and completion in the code view, from servers your machine has.")
      }
    }
    .formStyle(.grouped)
    .task { fonts = Self.monospacedFonts() }
    .onChange(of: prefs.editorSettings) { model.code.applySettings() }
  }

  private func serverBinding(_ language: SyntaxLanguage) -> Binding<Bool> {
    Binding(
      get: { !prefs.disabledLanguageServers.contains(language.rawValue) },
      set: { on in
        if on {
          prefs.disabledLanguageServers.remove(language.rawValue)
        } else {
          prefs.disabledLanguageServers.insert(language.rawValue)
        }
        MacTelemetry.capture(.settingsChanged(setting: .languageServers))
      })
  }

  /// Installed fixed-pitch families, by name.
  static func monospacedFonts() -> [String] {
    NSFontManager.shared.availableFontFamilies.filter { family in
      guard let font = NSFont(name: family, size: 13) else { return false }
      return font.isFixedPitch || font.fontDescriptor.symbolicTraits.contains(.monoSpace)
    }
  }
}

/// The languages a server can cover, in the order Settings lists them.
enum EditorLanguageServers {
  static let languages: [SyntaxLanguage] = [
    .swift, .typescript, .javascript, .json, .css, .html, .yaml, .objc, .kotlin, .python, .go, .rust, .ruby,
  ]
}
