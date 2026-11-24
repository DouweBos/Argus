import ArgusCore
import ArgusUI
import SwiftUI

/// `/teammates/gallery`: starting teammates. Picking one asks which projects
/// it looks after, then creates it paused, with its soul and duties.
struct TeammateGalleryScreen: View {
  @Environment(DesktopModel.self) private var model
  @Environment(TeammatesStore.self) private var store
  @Environment(HostStore.self) private var host
  @State private var picked: TeammatesStore.Template?
  @State private var repoRoots: [String] = []
  @State private var creating = false

  private let columns = [GridItem(.adaptive(minimum: 260, maximum: 360), spacing: 14)]

  var body: some View {
    ScrollView {
      LazyVGrid(columns: columns, alignment: .leading, spacing: 14) {
        ForEach(store.templates) { template in
          TemplateCard(template: template) {
            repoRoots = host.projects.map(\.repoRoot)
            picked = template
          }
        }
      }
      .padding(20)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .overlay {
      if store.templates.isEmpty { ProgressView() }
    }
    .navigationTitle("New Teammate")
    .navigationSubtitle("Each one starts paused; turn it on once you've read its duties")
    .sheet(item: $picked) { template in
      NavigationStack {
        Form {
          Section {
            HStack(spacing: 12) {
              TeammateAvatar(name: template.name, color: template.color, avatar: template.avatar, size: 40)
              VStack(alignment: .leading, spacing: 2) {
                Text(template.name).font(.headline)
                Text(template.tagline).foregroundStyle(.secondary)
              }
            }
          }
          ProjectScopeSection(selection: $repoRoots, footer: "Projects this teammate looks after.")
        }
        .formStyle(.grouped)
        .navigationTitle("Add \(template.name)")
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("Cancel") { picked = nil } }
          ToolbarItem(placement: .confirmationAction) {
            Button(creating ? "Adding" : "Add Teammate") { create(template) }.disabled(creating)
          }
        }
      }
      .frame(minWidth: 480, minHeight: 460)
    }
    .task {
      await host.refreshProjects()
      await store.loadTemplates()
    }
  }

  private func create(_ template: TeammatesStore.Template) {
    creating = true
    Task {
      let teammate = await store.createFromTemplate(template.id, repoRoots: repoRoots)
      creating = false
      picked = nil
      if let teammate { model.navigate(.teammate(id: teammate.id)) }
    }
  }
}

private struct TemplateCard: View {
  @Environment(\.theme) private var theme
  let template: TeammatesStore.Template
  let pick: () -> Void

  var body: some View {
    Button(action: pick) {
      VStack(alignment: .leading, spacing: 10) {
        HStack(spacing: 10) {
          TeammateAvatar(name: template.name, color: template.color, avatar: template.avatar, size: 34)
          VStack(alignment: .leading, spacing: 1) {
            Text(template.name).fontWeight(.semibold)
            Text("@\(template.handle)").font(.scaled(.caption)).foregroundStyle(.secondary)
          }
          Spacer(minLength: 0)
          Badge(label: template.autonomy.rawValue)
        }
        Text(template.tagline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        VStack(alignment: .leading, spacing: 3) {
          ForEach(template.dutyNames, id: \.self) { duty in
            Label(duty, systemImage: Icon.automations).font(.scaled(.caption))
          }
        }
        if !needs.isEmpty {
          Text("Needs \(needs)").font(.scaled(.caption)).foregroundStyle(.secondary)
        }
      }
      .padding(14)
      .frame(maxWidth: .infinity, alignment: .topLeading)
      .background(theme.surface, in: .rect(cornerRadius: 10))
      .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(theme.border))
      .contentShape(.rect)
    }
    .buttonStyle(.argusPlain)
  }

  private var needs: String {
    template.requires.map { $0.rawValue == "github" ? "GitHub" : $0.rawValue.capitalized }
      .joined(separator: " and ")
  }
}
