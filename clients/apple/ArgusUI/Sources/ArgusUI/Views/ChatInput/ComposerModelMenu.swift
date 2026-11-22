#if os(macOS)
  import ArgusCore

  /// The model pill's menu.
  @MainActor
  public enum ComposerModelMenu {
    @ChromeMenuBuilder
    public static func entries(_ composer: ComposerModel) -> [ChromeMenuEntry] {
      if composer.models.isEmpty {
        ChromeMenuEntry.note("No agent has reported its models yet.")
      } else {
        ChromeMenuEntry.header("Model")
        for model in composer.models {
          ChromeMenuItem(model.displayName, subtitle: model.description, checked: model.value == (composer.pickedModel ?? "default")) {
            composer.setModel(model.value)
          }
        }
      }
    }
  }
#endif
