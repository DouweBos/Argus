import AppKit
import ArgusCore
import ArgusUI
import SwiftUI
import UniformTypeIdentifiers

/// Share a skill as a gist or a GitHub repository, then hand over its link.
struct SkillShareSheet: View {
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  @State private var share: SkillShareModel

  init(share: SkillShareModel) {
    _share = State(initialValue: share)
  }

  var body: some View {
    VStack(spacing: 0) {
      Text("Share \(share.skill.name)").font(.scaled(.title2).weight(.semibold))
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding([.horizontal, .top], 24)
      Form {
        if let url = share.url {
          Section {
            Text(url).font(.system(.body, design: .monospaced)).textSelection(.enabled)
          } header: {
            Text("Published")
          } footer: {
            Text("Anyone with access can install it by pasting this link into Install Skill.")
          }
        } else {
          SkillShareFields(share: share)
          if let error = share.error {
            Section { Text(error).foregroundStyle(theme.error).textSelection(.enabled) }
          }
        }
      }
      .formStyle(.grouped)
      .disabled(share.sharing)
      footer
    }
    .frame(width: 520, height: 400)
  }

  @ViewBuilder
  private var footer: some View {
    HStack {
      if let url = share.url {
        Button("Copy Link") {
          NSPasteboard.general.clearContents()
          NSPasteboard.general.setString(url, forType: .string)
        }
        if let link = URL(string: url) { Link("Open", destination: link).clickable() }
        Spacer()
        Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
      } else {
        Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
        Spacer()
        Button(share.sharing ? "Publishing" : "Publish") { Task { await share.share() } }
          .keyboardShortcut(.defaultAction)
          .disabled(share.sharing)
      }
    }
    .padding()
  }
}

private struct SkillShareFields: View {
  @Bindable var share: SkillShareModel

  var body: some View {
    Section {
      Picker("As", selection: $share.target) {
        ForEach(SkillShareModel.Target.allCases, id: \.self) { Text($0.label).tag($0) }
      }
      .pickerStyle(.segmented)
      Picker("Visibility", selection: $share.isPublic) {
        Text(share.visibilityLabel.secret).tag(false)
        Text(share.visibilityLabel.open).tag(true)
      }
      if share.target == .repo {
        TextField("Repository", text: $share.repoName, prompt: Text(share.folderName))
          .font(.system(.body, design: .monospaced))
      }
    } footer: {
      Text(share.hint)
    }
  }
}

extension SkillPanels {
  static func chooseExportDestination(name: String) async -> URL? {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = "\(name).skill"
    panel.allowedContentTypes = [UTType(filenameExtension: "skill") ?? .zip]
    panel.message = "Save the skill as a file anyone can install"
    return await withCheckedContinuation { done in
      if let window = NSApp.keyWindow {
        panel.beginSheetModal(for: window) { done.resume(returning: $0 == .OK ? panel.url : nil) }
      } else {
        done.resume(returning: panel.runModal() == .OK ? panel.url : nil)
      }
    }
  }
}
