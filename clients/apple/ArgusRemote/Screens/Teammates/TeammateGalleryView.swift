import ArgusUI
import SwiftUI

/// Starting teammates to pick from. One is created paused, on the projects
/// picked here, and opens on its conversation.
struct TeammateGalleryView: View {
  @Environment(HostStore.self) private var host
  @Environment(TeammatesStore.self) private var store

  @State private var picked: TeammatesStore.Template?
  @State private var loaded = false

  var body: some View {
    Screen {
      if let error = store.error {
        Banner(text: error, tone: .danger)
      }
      if !loaded {
        Loading(label: "Reading templates")
      } else if store.templates.isEmpty {
        EmptyState(
          icon: Icon.person, title: "No templates",
          body: "This computer offered no starting teammates.")
      } else {
        MutedText("Each one starts paused, with its duties ready. Talk to it any time.")
        ForEach(store.templates) { template in
          TeammateTemplateCard(
            template: template, missing: missing(template),
            onTap: host.hasControl ? { picked = template } : nil)
        }
      }
    }
    .navigationTitle("New Teammate")
    .navigationBarTitleDisplayMode(.inline)
    .task {
      await store.loadTemplates()
      loaded = true
    }
    .sheet(item: $picked) { template in
      TeammateCreateSheet(template: template, missing: missing(template))
    }
  }

  /// What it needs that the computer hasn't connected. Git hosts aren't
  /// reported, so only what the computer can answer for is named.
  private func missing(_ template: TeammatesStore.Template) -> [String] {
    template.requires.compactMap { need in
      switch need {
      case .linear: host.linearConnected ? nil : "Linear"
      case .slack: "Slack"
      default: nil
      }
    }
  }
}

/// One starting teammate: who it is and the duties it comes with.
private struct TeammateTemplateCard: View {
  @Environment(\.theme) private var theme
  let template: TeammatesStore.Template
  let missing: [String]
  let onTap: (() -> Void)?

  var body: some View {
    Card(onTap: onTap) {
      HStack(alignment: .top, spacing: 12) {
        TeammateAvatar(name: template.name, color: template.color, avatar: template.avatar, size: 40)
        VStack(alignment: .leading, spacing: 4) {
          HStack(spacing: 6) {
            Text(template.name).font(.scaled(size: 16, weight: .semibold)).foregroundStyle(theme.text)
            Spacer(minLength: 0)
            if !missing.isEmpty {
              Badge(label: "Needs \(missing.joined(separator: ", "))", tone: .warning)
            }
          }
          if !template.tagline.isEmpty { MutedText(template.tagline) }
          if !template.dutyNames.isEmpty {
            FlowRow(spacing: 6, rowSpacing: 6, packed: true) {
              ForEach(template.dutyNames, id: \.self) { duty in
                Badge(label: duty)
              }
            }
            .padding(.top, 2)
          }
        }
      }
    }
  }
}

/// Picks the projects the new teammate works on, then creates it.
private struct TeammateCreateSheet: View {
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(TeammatesStore.self) private var store
  @Environment(\.dismiss) private var dismiss

  let template: TeammatesStore.Template
  let missing: [String]

  @State private var repoRoots: [String] = []
  @State private var creating = false

  var body: some View {
    NavigationStack {
      Screen {
        if let error = store.error {
          Banner(text: error, tone: .danger)
        }
        TeammateTemplateCard(template: template, missing: missing, onTap: nil)
        if !missing.isEmpty {
          MutedText(
            "Connect \(missing.joined(separator: " and ")) in Argus on the Mac for every duty to work.")
        }
        Field(label: "Scope", caption: "The repos it may read and work in. Change them later in its profile.") {
          ToggleList(
            title: "Projects",
            options: AutomationFields.projectOptions(host.projects, picked: repoRoots),
            selection: $repoRoots,
            emptyMessage: "This computer has no projects registered.")
        }
      }
      .navigationTitle(template.name)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(creating ? "Creating" : "Create") { create() }
            .disabled(creating || repoRoots.isEmpty || host.connection != .ready)
        }
      }
    }
    .presentationDetents([.medium, .large])
  }

  private func create() {
    creating = true
    Task {
      let teammate = await store.createFromTemplate(template.id, repoRoots: repoRoots)
      creating = false
      guard let teammate else { return }
      dismiss()
      // Back from the new teammate lands on the list, not the gallery.
      router.replaceTop(with: .teammate(id: teammate.id, page: .chat(threadId: nil)), dropping: 1)
    }
  }
}
