import ArgusCore
import ArgusUI
import SwiftUI

/// Colour scheme, colour theme and how large the interface is drawn.
struct AppearanceSettingsTab: View {
  @State private var prefs = AppPreferences.shared

  var body: some View {
    SettingsPage {
      VStack(alignment: .leading, spacing: 8) {
        SettingsGroupTitle("Colour scheme")
        ColorSchemeCards(selection: $prefs.theme.tracked(.theme), colorTheme: prefs.colorTheme)
      }
      VStack(alignment: .leading, spacing: 8) {
        SettingsGroupTitle("Colour theme")
        ColorThemeCards(selection: $prefs.colorTheme.tracked(.colorTheme))
      }
      SettingsGroup("Interface") {
        SettingsRow(
          "Display size", description: "Scale the entire UI larger for readability or smaller for more space."
        ) {
          Picker("Display size", selection: $prefs.displaySize.tracked(.displaySize)) {
            ForEach(DisplaySize.allCases, id: \.self) { Text($0.label).tag($0) }
          }
          .pickerStyle(.segmented)
        }
      }
    }
  }
}
