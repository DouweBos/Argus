import ArgusCore
import SwiftUI

/// A run's structured report. The computer validates these blocks, so anything
/// that arrives is well-formed and can be rendered without defensive checks.
public struct ReportBlocksView: View {
  @Environment(\.theme) private var theme
  let blocks: [RemoteReportBlock]
  /// Where the proposals block leads; the app owns navigation.
  public var onOpenInbox: () -> Void = {}

  public init(blocks: [RemoteReportBlock], onOpenInbox: @escaping () -> Void = {}) {
    self.blocks = blocks
    self.onOpenInbox = onOpenInbox
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
        view(for: block)
      }
    }
  }

  @ViewBuilder
  private func view(for block: RemoteReportBlock) -> some View {
    switch block {
    case .heading(let text):
      Text(text).font(.scaled(size: 16, weight: .bold)).foregroundStyle(theme.text)

    case .markdown(let text):
      MarkdownView(text: text)

    case .stats(let items):
      statsGrid(items)

    case .table(let columns, let rows):
      tableView(columns: columns, rows: rows)

    case .list(let items):
      VStack(alignment: .leading, spacing: 6) {
        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
          HStack(alignment: .top, spacing: 6) {
            Circle()
              .fill(tone(item.tone).color(theme))
              .frame(width: 5, height: 5)
              .padding(.top, 6)
            if let href = item.href, let url = URL(string: href) {
              // A Link's label is a button label, and a button centres a
              // wrapped one — spell out leading or long items read ragged.
              Link(destination: url) {
                listText(item.text, color: theme.accent)
              }
            } else {
              listText(item.text, color: theme.text)
            }
          }
        }
      }

    case .series(_, let labels, let values, let label):
      seriesView(labels: labels, values: values, label: label)

    case .proposals(let ids):
      Card(onTap: onOpenInbox) {
        HStack {
          Image(systemName: Icon.envelope).foregroundStyle(theme.accent)
          BodyText("\(ids.count) proposal\(ids.count == 1 ? "" : "s") in the inbox")
          Spacer()
          Image(systemName: Icon.chevronRight)
            .font(.scaled(size: 12, weight: .semibold))
            .foregroundStyle(theme.textMuted)
        }
      }

    case .sessions(let ids):
      // A session id isn't an agent id, so there is nothing honest to open.
      MutedText("\(ids.count) session\(ids.count == 1 ? "" : "s") touched")
    }
  }

  private func listText(_ text: String, color: Color) -> some View {
    Text(text)
      .font(.scaled(size: 14))
      .foregroundStyle(color)
      .multilineTextAlignment(.leading)
      .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func tone(_ reportTone: RemoteReportTone?) -> Tone {
    switch reportTone {
    case .critical: .danger
    case .warning: .warning
    case .positive: .success
    case .info, nil: .accent
    }
  }

  private func statsGrid(_ items: [RemoteStatItem]) -> some View {
    LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 8)], spacing: 8) {
      ForEach(Array(items.enumerated()), id: \.offset) { _, item in
        VStack(alignment: .leading, spacing: 3) {
          Text(item.label)
            .font(.scaled(size: 11)).foregroundStyle(theme.textMuted).lineLimit(1)
          Text(item.value)
            .font(.scaled(size: 18, weight: .semibold)).foregroundStyle(theme.text)
          if let delta = item.delta, delta != 0 {
            Text(delta > 0 ? "+\(formatted(delta))" : formatted(delta))
              .font(.scaled(size: 11, weight: .semibold))
              .foregroundStyle(delta > 0 ? theme.success : theme.error)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(theme.bgTertiary)
        .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
      }
    }
  }

  private func tableView(columns: [String], rows: [[RemoteCell]]) -> some View {
    ScrollView(.horizontal, showsIndicators: false) {
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 0) {
          ForEach(Array(columns.enumerated()), id: \.offset) { _, column in
            Text(column)
              .font(.scaled(size: 11, weight: .bold))
              .foregroundStyle(theme.textMuted)
              .frame(width: 130, alignment: .leading)
              .padding(.vertical, 6)
          }
        }
        if rows.isEmpty {
          MutedText("No rows.").padding(.vertical, 6)
        }
        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
          HStack(spacing: 0) {
            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
              Text(cell.text)
                .font(.scaled(size: 13))
                .foregroundStyle(theme.text)
                .frame(width: 130, alignment: .leading)
                .padding(.vertical, 5)
            }
          }
        }
      }
      .padding(.horizontal, 8)
    }
    .background(theme.bgTertiary)
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
  }

  private func seriesView(labels: [String], values: [Double], label: String?) -> some View {
    let peak = max(values.max() ?? 1, 1)
    return VStack(alignment: .leading, spacing: 6) {
      if let label { MutedText(label) }
      ForEach(Array(zip(labels, values).enumerated()), id: \.offset) { _, pair in
        HStack(spacing: 8) {
          Text(pair.0)
            .font(.scaled(size: 11))
            .foregroundStyle(theme.textMuted)
            .frame(width: 64, alignment: .leading)
            .lineLimit(1)
          GeometryReader { geometry in
            RoundedRectangle(cornerRadius: 3)
              .fill(theme.accent)
              .frame(width: max(2, geometry.size.width * (pair.1 / peak)))
          }
          .frame(height: 10)
          Text(formatted(pair.1))
            .font(.scaled(size: 11, design: .monospaced))
            .foregroundStyle(theme.textSecondary)
            .frame(width: 48, alignment: .trailing)
        }
      }
    }
  }

  private func formatted(_ value: Double) -> String {
    value == value.rounded() ? String(Int(value)) : String(format: "%.2f", value)
  }
}
