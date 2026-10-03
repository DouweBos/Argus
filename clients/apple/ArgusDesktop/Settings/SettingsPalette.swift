/// "Settings: <Tab>" in the command palette, straight to that tab.
@MainActor
enum SettingsPalette {
  static func register(in palette: CommandPaletteModel) {
    palette.register("settings") { model in
      SettingsTab.allCases.map { tab in
        PaletteCommand(
          id: "settings.\(tab.rawValue)", title: "Settings: \(tab.title)", section: "Settings",
          keywords: ["preferences"], systemImage: "gearshape", opensSettings: true
        ) { model.settingsTab = tab }
      }
    }
  }
}
