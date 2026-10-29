import ArgusCore
import ArgusKit
import SwiftUI

/// A Figma frame as the agent sees it: the render to zoom into, its layers,
/// the designers' comments and the file's other frames, plus a compare
/// against a device. Shared by the Mac's `/design` screen and the phone's.
public struct DesignViewerView: View {
  @Environment(\.theme) private var theme
  let model: DesignViewerModel
  /// Nil hides compare; empty shows it greyed out with `compareHint`.
  let compareTargets: [DesignCompareTarget]?
  let compareHint: String

  @State private var comparedOn: DesignCompareTarget?

  public init(
    model: DesignViewerModel, compareTargets: [DesignCompareTarget]? = nil,
    compareHint: String = "Boot a simulator to compare against it."
  ) {
    self.model = model
    self.compareTargets = compareTargets
    self.compareHint = compareHint
  }

  public var body: some View {
    Group {
      if let details = model.details {
        GeometryReader { geometry in
          if geometry.size.width >= 760 {
            split(details)
          } else {
            stacked(details)
          }
        }
      } else if let error = model.loadError {
        EmptyState(icon: Icon.warning, title: "Couldn't open the design", body: error, selectable: true)
      } else {
        Loading(label: "Asking Figma…").padding(.top, 48)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .background(theme.bg)
    .task { if model.details == nil, model.loadError == nil { await model.load() } }
    // The viewer's own Figma link goes to Figma, whatever opened the viewer.
    .environment(\.openURL, OpenURLAction { _ in .systemAction })
  }

  private func split(_ details: HostStore.FigmaFrameDetails) -> some View {
    HStack(spacing: 0) {
      VStack(alignment: .leading, spacing: 12) {
        header(details)
        notices
        if let comparison = model.comparison {
          ScrollView { comparisonView(comparison).padding(.bottom, theme.space) }
        } else {
          ZoomPanImage(data: model.image, label: details.frame.name)
            .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
        }
      }
      .padding(theme.space + 4)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      Rectangle().fill(theme.border).frame(width: 1)
      ScrollView {
        sections(details).padding(theme.space + 4)
      }
      .frame(width: 340)
    }
  }

  private func stacked(_ details: HostStore.FigmaFrameDetails) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        header(details)
        notices
        if let comparison = model.comparison {
          comparisonView(comparison)
        } else {
          ZoomPanImage(data: model.image, label: details.frame.name)
            .aspectRatio(max(details.frame.width, 1) / max(details.frame.height, 1), contentMode: .fit)
            .frame(maxHeight: 520)
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
        }
        sections(details)
      }
      .padding(theme.space + 4)
    }
  }

  private func header(_ details: HostStore.FigmaFrameDetails) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        if !model.history.isEmpty {
          IconBtn(systemName: Icon.chevronLeft, label: "Previous frame", size: 13) { Task { await model.back() } }
        }
        VStack(alignment: .leading, spacing: 2) {
          Text(details.frame.name)
            .font(.scaled(size: 18, weight: .semibold))
            .foregroundStyle(theme.text)
            .textSelection(.enabled)
          MutedText(subtitle(details), lineLimit: 2)
        }
      }
      HStack(spacing: 8) {
        compareControl
        if let url = URL(string: model.url) {
          Link(destination: url) {
            Label("Open in Figma", systemImage: Icon.openExternal)
              .font(.scaled(size: 13, weight: .semibold))
              .foregroundStyle(theme.textSecondary)
          }
          .clickable()
        }
      }
    }
  }

  private func subtitle(_ details: HostStore.FigmaFrameDetails) -> String {
    let size = "\(Int(details.frame.width))×\(Int(details.frame.height)) pt"
    let edited = model.lastModified.map { "edited \($0.formatted(.relative(presentation: .named)))" }
    return [details.file.name, size, edited].compactMap(\.self).joined(separator: " · ")
  }

  @ViewBuilder private var notices: some View {
    if model.designChanged {
      Banner(
        text: "The designer has saved a newer version of this file. The agent was given the earlier one.",
        tone: .warning, title: "Design changed since this session started")
    }
    if let error = model.compareError { Banner(text: error, tone: .danger, title: "Couldn't compare") }
  }

  @ViewBuilder private var compareControl: some View {
    if let targets = compareTargets {
      let label = model.comparing ? "Comparing…" : "Compare with Simulator"
      if targets.count > 1 {
        Menu {
          ForEach(targets) { target in Button(target.name) { compare(target) } }
        } label: {
          Label(label, systemImage: Icon.compare).font(.scaled(size: 13, weight: .semibold))
        }
        .fixedSize()
        .disabled(model.comparing)
        .clickable()
      } else {
        Btn(label: label, tone: .secondary, small: true, icon: Icon.compare, hugs: true) {
          if let target = targets.first { compare(target) }
        }
        .disabled(targets.isEmpty || model.comparing)
        .help(targets.first.map { "Diff the frame against \($0.name)" } ?? compareHint)
      }
      if targets.isEmpty { MutedText(compareHint, lineLimit: 2) }
    }
  }

  private func comparisonView(_ comparison: HostStore.DesignComparison) -> some View {
    DesignComparisonView(
      comparison: comparison, percent: model.differingPercent ?? 0, deviceName: comparedOn?.name
    ) { model.clearComparison() }
  }

  private func sections(_ details: HostStore.FigmaFrameDetails) -> some View {
    VStack(alignment: .leading, spacing: 20) {
      if !details.comments.isEmpty { DesignCommentsSection(comments: details.comments) }
      DesignLayersSection(layers: details.layers)
      if !details.pages.isEmpty {
        DesignPagesSection(pages: details.pages, isCurrent: model.isCurrent) { url in
          Task { await model.open(url) }
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func compare(_ target: DesignCompareTarget) {
    comparedOn = target
    Task { await model.compare(with: target) }
  }
}
