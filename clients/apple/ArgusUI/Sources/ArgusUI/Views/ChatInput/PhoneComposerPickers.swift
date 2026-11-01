#if os(iOS)
  import ArgusKit
  import SwiftUI

  /// Which sheet the phone composer's chip row has open.
  enum PhoneComposerPicker: String, Identifiable {
    case model, account, mode, effort, project
    var id: String { rawValue }
  }

  /// The phone composer's chips, in the Mac's order — model (and account),
  /// effort, mode, linked projects — after the context meter. They wrap rather
  /// than scroll, so none sits hidden past the edge.
  struct PhoneComposerChips: View {
    let composer: ComposerModel
    @Binding var picker: PhoneComposerPicker?

    var body: some View {
      ChipFlowLayout(spacing: 6, lineSpacing: 6) {
        if composer.contextTokens > 0 {
          ContextMeter(tokens: composer.contextTokens, limit: composer.contextLimit)
        }
        Chip(label: composer.modelLabel, icon: Icon.agent) { picker = .model }
        if composer.offersAccounts {
          Chip(label: composer.accountLabel, icon: Icon.person) { picker = .account }
        }
        if !composer.effortLevels.isEmpty {
          Chip(label: ComposerEffort.label(composer.effort), icon: Icon.clock) { picker = .effort }
        }
        Chip(
          label: ComposerPermissionMode.label(composer.permissionMode), icon: Icon.lock,
          tone: composer.permissionMode == .auto ? nil : .accent
        ) { picker = .mode }
        // Only the icon until something is linked, as on the Mac.
        Chip(
          label: composer.linkedProjects.isEmpty ? "" : "\(composer.linkedProjects.count) linked",
          icon: Icon.link, tone: composer.linkedProjects.isEmpty ? nil : .accent
        ) { picker = .project }
        .accessibilityLabel(composer.linkedProjects.isEmpty ? "Link project" : "\(composer.linkedProjects.count) linked")
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  struct PhoneComposerPickerSheet: View {
    let composer: ComposerModel
    let which: PhoneComposerPicker

    /// The effort picker's value for "no level": the CLI default.
    private static let defaultEffort = ""

    var body: some View {
      switch which {
      case .model:
        PickerSheet(
          title: "Model",
          options: composer.models.map { .init(value: $0.value, label: $0.displayName, hint: $0.description) },
          selected: [composer.pickedModel ?? "default"],
          emptyMessage: "No agent has reported its models yet."
        ) { composer.setModel($0) }
      case .account:
        PickerSheet(
          title: "Account",
          options: [
            .init(
              value: ComposerModel.followDefaultAccount, label: "Follow computer default",
              hint: composer.activeAccountName)
          ]
            + composer.accounts.map {
              .init(value: $0.id, label: $0.displayName, hint: $0.subtitle.isEmpty ? nil : $0.subtitle)
            },
          selected: [composer.accountId]
        ) { composer.setAccount($0) }
      case .mode:
        PickerSheet(
          title: "Permission mode",
          options: RemotePermissionMode.allCases.map {
            .init(
              value: $0.rawValue, label: ComposerPermissionMode.label($0),
              hint: ComposerPermissionMode.description($0))
          },
          selected: [composer.permissionMode.rawValue]
        ) { value in
          guard let picked = RemotePermissionMode(rawValue: value) else { return }
          composer.setPermissionMode(picked)
        }
      case .effort:
        PickerSheet(
          title: "Effort",
          options: ([Self.defaultEffort] + composer.effortLevels).map {
            .init(value: $0, label: ComposerEffort.label($0 == Self.defaultEffort ? nil : $0))
          },
          selected: [composer.effort ?? Self.defaultEffort]
        ) { composer.setEffort($0 == Self.defaultEffort ? nil : $0) }
      case .project:
        PickerSheet(
          title: "Linked projects",
          options: composer.linkableProjects.map { .init(value: $0.repoRoot, label: $0.name, hint: $0.repoRoot) },
          selected: Set(composer.linkedProjects),
          multi: true,
          emptyMessage: "No other projects"
        ) { composer.toggleLink($0) }
      }
    }
  }
#endif
