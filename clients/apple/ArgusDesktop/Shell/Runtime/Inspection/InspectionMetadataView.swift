import ArgusUI
import SwiftUI

/// Everything the capture knows about the selected node, with the
/// whitelisted properties editable in place — `NodeMetadataPanel`.
struct InspectionMetadataView: View {
  @Environment(\.theme) private var theme
  let model: InspectionModel

  var body: some View {
    if let node = model.selectedNode {
      VStack(spacing: 0) {
        header(node)
        Divider()
        if let error = model.editError {
          Text(error)
            .font(.scaled(.caption))
            .foregroundStyle(theme.error)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(theme.errorSoft)
        }
        ScrollView {
          VStack(alignment: .leading, spacing: 14) {
            InspectionNodeSections(model: model, node: node)
            InspectionPropsSection(model: model, nodeId: node.id)
          }
          .padding(10)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .id(node.id)
      }
      .background(theme.bg)
    } else {
      EmptyState(
        icon: "cursorarrow.rays", title: "No element selected",
        body: "Click an element in the capture to see its metadata here."
      )
      .background(theme.bg)
    }
  }

  private func header(_ node: Inspection.Node) -> some View {
    HStack(spacing: 6) {
      Text("Inspecting").font(.scaled(.caption)).foregroundStyle(theme.textMuted)
      Text(node.className).font(.scaled(size: 12, weight: .semibold, design: .monospaced))
        .lineLimit(1)
        .truncationMode(.middle)
      Spacer(minLength: 0)
      if model.editSaving {
        ProgressView().controlSize(.small)
        Text("Applying…").font(.scaled(.caption)).foregroundStyle(theme.textMuted)
      }
    }
    .padding(.horizontal, 10)
    .frame(height: 28)
  }
}

/// The capture's own fields, grouped like the renderer's panel.
private struct InspectionNodeSections: View {
  @Environment(\.theme) private var theme
  let model: InspectionModel
  let node: Inspection.Node

  private var textSettable: Bool { Inspection.textSettableClasses.contains(node.className) }

  var body: some View {
    let rect = node.rect
    InspectionSection("Identity") {
      if let text = node.text ?? node.title {
        InspectionRow("Text") {
          if textSettable {
            InspectionTextEdit(value: text, commit: edit("text"))
          } else {
            // RN text renders from React state; a native set would always fail.
            Text(text) + Text(" · React-managed").foregroundStyle(theme.textMuted)
          }
        }
      }
      InspectionRow("Placeholder", node.placeholder)
      InspectionRow("A11y label", node.accessibilityLabel)
      InspectionRow("A11y id", node.accessibilityIdentifier)
      InspectionRow("Node id", node.id)
    }
    InspectionSection("Geometry") {
      InspectionRow("Origin", "\(Inspection.format(rect.x)), \(Inspection.format(rect.y))")
      InspectionRow("Size", "\(Inspection.format(rect.w)) × \(Inspection.format(rect.h))")
      InspectionRow("Depth", String(node.depth))
      InspectionRow("Z", node.z.map(Inspection.format))
      InspectionRow("Children", String(node.children.count))
    }
    appearance
    layer
    if let rn = node.rn {
      InspectionSection("React Native") {
        InspectionRow("reactTag", rn.reactTag)
        InspectionRow("nativeID", rn.nativeID)
        InspectionRow("testID", rn.testID)
      }
    }
    InspectionSection("State") {
      InspectionRow("Alpha") {
        InspectionNumberEdit(value: node.alpha ?? 1, range: 0...1, commit: edit("alpha"))
      }
      InspectionRow("Hidden") {
        InspectionBoolEdit(value: node.hidden, commit: edit("hidden"))
      }
      InspectionRow("Enabled", node.enabled.map { String($0) })
      InspectionRow("Truncated", node.truncated.map { "\($0) subviews" })
    }
  }

  @ViewBuilder
  private var appearance: some View {
    let hasFont = node.font.map { !$0.name.isEmpty || $0.size > 0 } ?? false
    let anyColor =
      node.backgroundColor ?? node.textColor ?? node.titleColor ?? node.tintColor
      ?? node.gradientColors?.first
    if anyColor != nil || hasFont || node.image != nil {
      InspectionSection("Appearance") {
        color("Background", node.backgroundColor, key: "backgroundColor")
        color("Text", node.textColor, key: textSettable ? "textColor" : nil)
        color("Title", node.titleColor)
        color("Tint", node.tintColor, key: "tintColor")
        ForEach(Array((node.gradientColors ?? []).enumerated()), id: \.offset) { index, hex in
          color(index == 0 ? "Gradient" : "", hex)
        }
        if hasFont, let font = node.font { InspectionRow("Font", fontLabel(font)) }
        if let image = node.image {
          let name = image.name.map { " · \($0)" } ?? ""
          InspectionRow(
            "Image",
            "\(Inspection.format(image.w))×\(Inspection.format(image.h))@\(Inspection.format(image.scale))x\(name)"
          )
        }
      }
    }
  }

  @ViewBuilder
  private var layer: some View {
    if node.cornerRadius != nil || node.borderWidth != nil || node.shadowOpacity != nil
      || node.masksToBounds || node.hasMask || node.transform3D != nil
    {
      InspectionSection("Layer") {
        if let radius = node.cornerRadius {
          InspectionRow("Corner radius") {
            InspectionNumberEdit(value: radius, range: 0...10_000, commit: edit("cornerRadius"))
          }
        }
        InspectionRow("Masks to bounds", node.masksToBounds ? "true" : nil)
        InspectionRow("Mask", node.hasMask ? "true" : nil)
        if let width = node.borderWidth {
          InspectionRow("Border") {
            InspectionNumberEdit(value: width, range: 0...10_000, commit: edit("borderWidth"))
          }
        }
        color("Border color", node.borderColor, key: "borderColor")
        if let opacity = node.shadowOpacity {
          InspectionRow(
            "Shadow",
            "opacity \(Inspection.format(opacity)) · radius \(Inspection.format(node.shadowRadius ?? 0))"
          )
        }
        color("Shadow color", node.shadowColor)
        InspectionRow("3D transform", node.transform3D == nil ? nil : "non-identity")
      }
    }
  }

  @ViewBuilder
  private func color(_ label: String, _ hex: String?, key: String? = nil) -> some View {
    if let hex {
      InspectionRow(label) {
        if let key {
          InspectionColorEdit(value: hex, commit: edit(key))
        } else {
          InspectionColorSwatch(hex: hex)
        }
      }
    }
  }

  private func edit(_ key: String) -> (String) -> Void {
    let nodeId = node.id
    return { value in
      Task { await model.setProperty(nodeId: nodeId, key: key, value: value) }
    }
  }

  private func fontLabel(_ font: Inspection.Font) -> String {
    var bits = [font.family.isEmpty ? font.name : font.family, "\(Inspection.format(font.size))pt"]
    if let weight = font.weight { bits.append("w\(Inspection.format(weight))") }
    if font.bold { bits.append("bold") }
    if font.italic { bits.append("italic") }
    return bits.filter { !$0.isEmpty }.joined(separator: " · ")
  }
}

/// A titled group of rows.
struct InspectionSection<Content: View>: View {
  @Environment(\.theme) private var theme
  let title: String
  @ViewBuilder let content: Content

  init(_ title: String, @ViewBuilder content: () -> Content) {
    self.title = title
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(title.uppercased())
        .font(.scaled(size: 10, weight: .semibold))
        .foregroundStyle(theme.textMuted)
      content
    }
  }
}

/// A label and its value; a nil or empty text value hides the row.
struct InspectionRow<Value: View>: View {
  @Environment(\.theme) private var theme
  let label: String
  let value: Value?

  init(_ label: String, @ViewBuilder value: () -> Value) {
    self.label = label
    self.value = value()
  }

  var body: some View {
    if let value {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(label)
          .foregroundStyle(theme.textMuted)
          .frame(width: 96, alignment: .leading)
        value
          .foregroundStyle(theme.text)
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .font(.scaled(size: 11))
    }
  }
}

extension InspectionRow where Value == Text {
  init(_ label: String, _ text: String?) {
    self.label = label
    self.value = text.flatMap { $0.isEmpty ? nil : Text($0) }
  }
}
