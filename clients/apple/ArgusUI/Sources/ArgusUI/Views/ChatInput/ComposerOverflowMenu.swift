#if os(macOS)
  import ArgusCore

  /// The ⋮ pill's menu: a submenu per setting that has no pill of its own.
  @MainActor
  public enum ComposerOverflowMenu {
    @ChromeMenuBuilder
    public static func entries(_ composer: ComposerModel) -> [ChromeMenuEntry] {
      if composer.offersAccounts {
        ChromeMenuEntry.submenu("Account", subtitle: composer.effectiveAccountName, icon: .symbol(Icon.person)) {
          accounts(composer)
        }
      }
    }

    @ChromeMenuBuilder
    private static func accounts(_ composer: ComposerModel) -> [ChromeMenuEntry] {
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
#endif
