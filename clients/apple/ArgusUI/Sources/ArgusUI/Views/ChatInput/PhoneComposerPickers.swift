#if os(iOS)
  import ArgusCore
  import ArgusKit
  import SwiftUI

  /// Which sheet the phone composer's chip row has open.
  enum PhoneComposerPicker: String, Identifiable {
    case model, account, mode, effort, project, sideQuestion
    var id: String { rawValue }
  }

  /// The pills along the phone composer's foot, as the Mac's: model (and
  /// account), effort and permission mode drop a menu in place; linked projects
  /// and side questions open a sheet. They wrap rather than scroll.
  struct PhoneComposerPills: View {
    let composer: ComposerModel
    @Binding var picker: PhoneComposerPicker?
    @Environment(HostStore.self) private var host

    private var asked: Int { host.sideQuestionsByAgent[composer.agentId]?.count ?? 0 }

    var body: some View {
      ChipFlowLayout(spacing: 2, lineSpacing: 2) {
        modelMenu
        if !composer.effortLevels.isEmpty {
          ComposerPillDivider()
          effortMenu
        }
        ComposerPillDivider()
        modeMenu
        ComposerPillDivider()
        Button { picker = .project } label: {
          ComposerPillLabel(
            icon: Icon.link, title: composer.linkedProjects.isEmpty ? nil : "\(composer.linkedProjects.count) linked",
            accent: !composer.linkedProjects.isEmpty, chevron: !composer.linkedProjects.isEmpty)
        }
        .buttonStyle(.argusPlain)
        .accessibilityLabel(composer.linkedProjects.isEmpty ? "Link project" : "\(composer.linkedProjects.count) linked")
        if composer.starter == nil && host.supportsSideQuestion(agentId: composer.agentId) {
          ComposerPillDivider()
          Button { picker = .sideQuestion } label: {
            ComposerPillLabel(
              icon: Icon.sideQuestion, title: asked == 0 ? nil : "\(asked)", accent: asked > 0, chevron: false)
          }
          .buttonStyle(.argusPlain)
          .accessibilityLabel("Side question")
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .disabled(!composer.isEnabled)
    }

    private var modelMenu: some View {
      Menu {
        if composer.models.isEmpty {
          Text("No agent has reported its models yet.")
        } else {
          Picker("Model", selection: Binding(get: { composer.pickedModel ?? "default" }, set: composer.setModel)) {
            ForEach(composer.models, id: \.value) { model in
              Button {} label: {
                Text(model.displayName)
                if !model.description.isEmpty { Text(model.description) }
              }
              .tag(model.value)
            }
          }
          .pickerStyle(.inline)
        }
        if composer.offersAccounts {
          Picker("Account", selection: Binding(get: { composer.accountId }, set: composer.setAccount)) {
            Text("Follow computer default").tag(ComposerModel.followDefaultAccount)
            ForEach(composer.accounts, id: \.id) { account in
              Label(account.displayName, systemImage: Icon.person).tag(account.id)
            }
          }
          .pickerStyle(.inline)
        }
      } label: {
        ComposerPillLabel(icon: Icon.agent, title: composer.modelLabel)
      }
      .menuIndicator(.hidden)
      .accessibilityLabel("Model: \(composer.modelLabel)")
    }

    private var effortMenu: some View {
      Menu {
        Picker("Effort", selection: Binding(get: { composer.effort }, set: composer.setEffort)) {
          ForEach([String?.none] + composer.effortLevels.map(Optional.some), id: \.self) { level in
            Text(ComposerEffort.label(level)).tag(level)
          }
        }
        .pickerStyle(.inline)
      } label: {
        ComposerPillLabel(icon: Icon.clock, title: ComposerEffort.label(composer.effort))
      }
      .menuIndicator(.hidden)
      .accessibilityLabel("Effort: \(ComposerEffort.label(composer.effort))")
    }

    private var modeMenu: some View {
      Menu {
        Picker("Permission mode", selection: Binding(get: { composer.permissionMode }, set: composer.setPermissionMode)) {
          ForEach(RemotePermissionMode.allCases, id: \.self) { mode in
            Button {} label: {
              Text(ComposerPermissionMode.label(mode))
              Text(ComposerPermissionMode.description(mode))
            }
            .tag(mode)
          }
        }
        .pickerStyle(.inline)
      } label: {
        ComposerPillLabel(
          icon: Icon.lock, title: ComposerPermissionMode.label(composer.permissionMode),
          accent: composer.permissionMode != .auto)
      }
      .menuIndicator(.hidden)
      .accessibilityLabel("Permission mode: \(ComposerPermissionMode.label(composer.permissionMode))")
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
      case .sideQuestion:
        SideQuestionPanel(agentId: composer.agentId) { composer.onAffordance?(.sideAnswerSent) }
          .padding()
          .presentationDetents([.medium, .large])
      }
    }
  }
#endif
