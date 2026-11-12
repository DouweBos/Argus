#if os(macOS)
  import ArgusCore

  /// The model pill's menu: the models, then the Claude account the agent runs as.
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
      if composer.offersAccounts {
        ChromeMenuEntry.divider
        ChromeMenuEntry.header("Account")
        if composer.offersFollowDefault {
          ChromeMenuItem(
            "Follow computer default", subtitle: composer.activeAccountName,
            checked: composer.checkedAccountId == ComposerModel.followDefaultAccount
          ) {
            composer.setAccount(ComposerModel.followDefaultAccount)
          }
        }
        for account in composer.accounts {
          ChromeMenuItem(
            account.displayName, subtitle: composer.accountHint(account.id), icon: .symbol(Icon.person),
            checked: composer.checkedAccountId == account.id
          ) {
            composer.setAccount(account.id)
          }
        }
      }
    }
  }
#endif
