import ArgusUI
import SwiftUI

/// The selected node's React Native props, fetched lazily from the in-process
/// `/props` endpoint. Renders nothing for non-Fabric views or an older dylib
/// without it — `NodePropsSection`.
struct InspectionPropsSection: View {
  @Environment(\.theme) private var theme
  let model: InspectionModel
  let nodeId: String

  @State private var props: ArgusProtocol.NodeProps?

  var body: some View {
    content
      .task(id: nodeId) {
        props = nil
        props = await model.nodeProps(nodeId)
      }
  }

  @ViewBuilder
  private var content: some View {
    if let props, props.isFabric != false {
      let bag = props.rawProps ?? props.props ?? [:]
      if !bag.isEmpty || props.note != nil {
        InspectionSection(props.rawProps == nil && !bag.isEmpty ? "React props (native)" : "React props") {
          if !bag.isEmpty { InspectionFields(values: bag) }
          if let note = props.note {
            Text(note).font(.scaled(.caption)).foregroundStyle(theme.textMuted)
          }
        }
      }
    }
  }
}

/// An unknown JSON bag as labelled fields: scalars inline, objects and arrays
/// nested under their key.
struct InspectionFields: View {
  @Environment(\.theme) private var theme
  let entries: [(key: String, value: JSONValue)]

  init(values: [String: JSONValue]) {
    entries = values.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
  }

  init(items: [JSONValue]) {
    entries = items.enumerated().map { ("[\($0.offset)]", $0.element) }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      ForEach(entries, id: \.key) { entry in
        field(entry.key, entry.value)
      }
    }
  }

  private func field(_ key: String, _ value: JSONValue) -> AnyView {
    switch value {
    case .object(let object):
      return AnyView(nested(key, InspectionFields(values: object)))
    case .array(let items):
      return AnyView(nested("\(key) (\(items.count))", InspectionFields(items: items)))
    default:
      return AnyView(
        InspectionRow(key) {
          Text(Self.scalar(value)).font(.scaled(size: 11, design: .monospaced))
        })
    }
  }

  private func nested(_ title: String, _ fields: InspectionFields) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(title).font(.scaled(size: 11)).foregroundStyle(theme.textMuted)
      if fields.entries.isEmpty {
        Text("empty").font(.scaled(.caption)).foregroundStyle(theme.textMuted).padding(.leading, 12)
      } else {
        fields.padding(.leading, 12)
      }
    }
  }

  private static func scalar(_ value: JSONValue) -> String {
    switch value {
    case .null: "null"
    case .bool(let b): String(b)
    case .number(let n): Inspection.format(n)
    case .string(let s): s
    case .array, .object: ""
    }
  }
}
