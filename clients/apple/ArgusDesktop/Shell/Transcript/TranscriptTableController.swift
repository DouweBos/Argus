import AppKit
import ArgusCore
import ArgusUI
import SwiftUI

/// Drives the transcript table: the strip above the history, a row per segment,
/// the foot. Heights are measured near the viewport and cached; changes above the
/// reader keep their row in place, unless they're following the tail.
@MainActor
final class TranscriptTableController: NSObject, NSTableViewDataSource, NSTableViewDelegate {
  let follow = FollowState()
  let model: TranscriptModel
  /// The reader neared the top and the host has older pages.
  var onNeedOlder: () -> Void = {}

  let scrollView = TranscriptScrollView()
  let table = TranscriptTableView()
  private let sizer = NSHostingController(rootView: AnyView(EmptyView()))

  private(set) var agentKey = ""
  private var segments = TranscriptSegments()
  private var revisions: [String: Int] = [:]
  private var top = TranscriptRow.TopState()
  private var footer = TranscriptRow.FooterState()
  private(set) var environment = EnvironmentValues()
  private(set) var environmentKey = ""
  private var heights = TranscriptRowHeights()
  private var landed = false
  /// Our own scrolling, which says nothing about where the reader wants to be.
  private var adjusting = 0
  private var lastWidth: CGFloat = 0
  nonisolated(unsafe) private var wheelMonitor: Any?

  init(model: TranscriptModel) {
    self.model = model
    super.init()
    let column = NSTableColumn(identifier: .init("row"))
    column.resizingMask = .autoresizingMask
    table.addTableColumn(column)
    table.headerView = nil
    table.style = .plain
    table.intercellSpacing = .zero
    table.backgroundColor = .clear
    table.selectionHighlightStyle = .none
    table.gridStyleMask = []
    table.columnAutoresizingStyle = .uniformColumnAutoresizingStyle
    table.allowsColumnResizing = false
    table.focusRingType = .none
    table.usesAutomaticRowHeights = false
    table.dataSource = self
    table.delegate = self
    scrollView.documentView = table
    scrollView.drawsBackground = false
    scrollView.hasVerticalScroller = true
    scrollView.hasHorizontalScroller = false
    scrollView.autohidesScrollers = true
    scrollView.contentView.postsBoundsChangedNotifications = true
    scrollView.contentView.postsFrameChangedNotifications = true
    let center = NotificationCenter.default
    center.addObserver(
      self, selector: #selector(boundsChanged), name: NSView.boundsDidChangeNotification, object: scrollView.contentView)
    center.addObserver(
      self, selector: #selector(frameChanged), name: NSView.frameDidChangeNotification, object: scrollView.contentView)
    observeFind()
    wheelMonitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
      // Delivered on the main thread, with the event being dispatched.
      nonisolated(unsafe) let event = event
      let redirected = MainActor.assumeIsolated { self?.scrollView.takeWheel(event) == true }
      return redirected ? nil : event
    }
  }

  deinit {
    if let wheelMonitor { NSEvent.removeMonitor(wheelMonitor) }
  }

  // MARK: Rows

  private var rowCount: Int { segments.segments.count + 2 }

  func row(_ index: Int) -> TranscriptRow {
    if index == 0 { return .top(top) }
    if index == rowCount - 1 { return .footer(footer) }
    return .segment(segments.segments[index - 1])
  }

  func id(_ index: Int) -> String {
    if index == 0 { return "top" }
    if index == rowCount - 1 { return "footer" }
    return segments.segments[index - 1].id
  }

  func revision(_ id: String) -> Int { revisions[id] ?? 0 }

  private func root(_ index: Int) -> AnyView {
    TranscriptRow.root(row(index), id: id(index), agentKey: agentKey, model: model, environment: environment)
  }

  private var width: CGFloat { max(scrollView.contentView.bounds.width, 1) }

  /// A message that is only text — no badges, attachments or tool calls — and
  /// so can be drawn by a plain AppKit text cell.
  func plainText(_ index: Int) -> (RemoteMessage, NSAttributedString)? {
    guard case .segment(.single(let message)) = row(index), message.role != .user, message.toolCalls.isEmpty,
      (message.images ?? []).isEmpty, message.isError != true, message.source == nil, message.author == nil,
      let text = model.text(for: message)
    else { return nil }
    return (message, text)
  }

  // MARK: Updates

  func update(
    agentKey: String, messages: [RemoteMessage], top: TranscriptRow.TopState, footer: TranscriptRow.FooterState,
    environment: EnvironmentValues
  ) {
    if agentKey != self.agentKey { reset(agentKey) }
    self.environment = environment
    let key = Self.environmentKey(environment)
    let restyled = key != environmentKey
    environmentKey = key
    let change = segments.update(messages)
    let topChanged = top != self.top
    let footerChanged = footer != self.footer
    self.top = top
    self.footer = footer
    guard !change.isEmpty || topChanged || footerChanged || restyled else { return }

    let wasEmpty = table.numberOfRows == 0
    keepingPlace(anchorShift: change) {
      if wasEmpty {
        table.reloadData()
      } else {
        table.beginUpdates()
        if !change.removed.isEmpty {
          table.removeRows(at: IndexSet(integersIn: (change.removed.lowerBound + 1)..<(change.removed.upperBound + 1)))
        }
        if !change.inserted.isEmpty {
          table.insertRows(
            at: IndexSet(integersIn: (change.inserted.lowerBound + 1)..<(change.inserted.upperBound + 1)))
        }
        table.endUpdates()
      }
      var changed = IndexSet(change.reloaded.map { $0 + 1 })
      if topChanged { changed.insert(0) }
      if footerChanged { changed.insert(rowCount - 1) }
      for index in changed { revisions[id(index), default: 0] += 1 }
      if restyled {
        heights.forgetAll()
        changed = IndexSet(integersIn: 0..<rowCount)
      }
      for index in changed { configureVisibleCell(index) }
      measure(changed.filter(isNearViewport), always: true)
      note(changed)
    }
    if !landed, !messages.isEmpty {
      landed = true
      scrollToBottom()
    }
    measureAroundViewport()
    loadOlderIfNeeded()
  }

  private func reset(_ key: String) {
    agentKey = key
    segments = TranscriptSegments()
    revisions = [:]
    heights = TranscriptRowHeights()
    landed = false
    follow.atBottom = true
    if table.numberOfRows > 0 { table.reloadData() }
  }

  /// What a hosted row looks like depends on these beyond the row itself.
  private static func environmentKey(_ environment: EnvironmentValues) -> String {
    let links = environment.transcriptLinks.map { "\(ObjectIdentifier($0))" } ?? "-"
    return "\(environment.colorScheme)|\(environment.dynamicTypeSize)|\(TextScale.shared.factor)|\(links)"
  }

  // MARK: Table

  func numberOfRows(in tableView: NSTableView) -> Int {
    agentKey.isEmpty ? 0 : rowCount
  }

  func tableView(_ tableView: NSTableView, heightOfRow index: Int) -> CGFloat {
    let id = id(index)
    let height = heights.guess(id, revision: revision(id), width: width, row: row(index))
    heights.report(id, height)
    return max(height, 1)
  }

  // MARK: Heights

  private func isNearViewport(_ index: Int) -> Bool {
    let visible = scrollView.contentView.bounds
    let band = visible.insetBy(dx: 0, dy: -visible.height)
    return index < table.numberOfRows && table.rect(ofRow: index).intersects(band)
  }

  /// Lays the rows out at the current width, unless already known; returns
  /// the ones whose height moved from what the table has.
  @discardableResult
  private func measure(_ indices: some Sequence<Int>, always: Bool = false) -> IndexSet {
    var moved = IndexSet()
    let width = width
    for index in indices {
      let id = id(index)
      let revision = revision(id)
      if always || heights.exact(id, revision: revision, width: width) == nil {
        let height: CGFloat
        if let (_, text) = plainText(index) {
          height = TranscriptTextCell.height(of: text, width: width)
        } else {
          sizer.rootView = root(index)
          let size = sizer.sizeThatFits(in: CGSize(width: width, height: .greatestFiniteMagnitude))
          height = size.height.isFinite ? ceil(size.height) : 40
        }
        heights.store(id, revision: revision, width: width, height: height)
      }
      if heights.exact(id, revision: revision, width: width) != heights.reported[id] { moved.insert(index) }
    }
    return moved
  }

  private func note(_ indices: IndexSet) {
    guard !indices.isEmpty else { return }
    table.noteHeightOfRows(withIndexesChanged: indices)
  }

  /// The rows on screen are measured before they draw. Two screens above and
  /// one below follow a row per run-loop turn, nearest first and upward first
  /// (where a reader of history is heading), so scrolling into them shifts
  /// nothing and no single pass measures a screenful.
  private func measureAroundViewport() {
    guard table.numberOfRows > 0 else { return }
    let visible = table.rows(in: scrollView.contentView.bounds)
    let moved = measure(visible.location..<(visible.location + visible.length))
    if !moved.isEmpty { keepingPlace { note(moved) } }
    schedulePrefetch()
  }

  private var prefetching = false

  private func schedulePrefetch() {
    guard !prefetching else { return }
    prefetching = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.prefetching = false
      guard let index = self.nextUnmeasured() else { return }
      let moved = self.measure([index])
      if !moved.isEmpty { self.keepingPlace { self.note(moved) } }
      self.schedulePrefetch()
    }
  }

  private func nextUnmeasured() -> Int? {
    guard table.numberOfRows > 0 else { return nil }
    let visible = scrollView.contentView.bounds
    let above = table.rows(
      in: NSRect(x: 0, y: visible.minY - visible.height * 2, width: visible.width, height: visible.height * 2))
    let below = table.rows(in: NSRect(x: 0, y: visible.maxY, width: visible.width, height: visible.height))
    let candidates =
      Array(stride(from: above.location + above.length - 1, through: above.location, by: -1))
      + Array(below.location..<(below.location + below.length))
    let width = width
    return candidates.first { index in
      index >= 0 && index < rowCount && heights.exact(id(index), revision: revision(id(index)), width: width) == nil
    }
  }

  /// A hosted row laid out at a height the table doesn't have: it resized
  /// itself, or was measured before an image or a form arrived. Applied once
  /// this layout pass is over, all together.
  func rowLaidOut(_ id: String, revision: Int, height: CGFloat) {
    guard revision == self.revision(id), height.isFinite, height > 0 else { return }
    let height = ceil(height)
    guard heights.reported[id].map({ abs($0 - height) > 0.5 }) ?? false else { return }
    let first = laidOut.isEmpty
    laidOut[id] = height
    guard first else { return }
    DispatchQueue.main.async { [weak self] in self?.applyLaidOut() }
  }

  private var laidOut: [String: CGFloat] = [:]

  private func applyLaidOut() {
    let pending = laidOut
    laidOut = [:]
    let width = width
    let visible = scrollView.contentView.bounds
    let band = table.rows(in: visible.insetBy(dx: 0, dy: -visible.height))
    var moved = IndexSet()
    for index in band.location..<(band.location + band.length) {
      let id = id(index)
      guard let height = pending[id] else { continue }
      heights.store(id, revision: revision(id), width: width, height: height)
      moved.insert(index)
    }
    if !moved.isEmpty { keepingPlace { note(moved) } }
  }

  // MARK: Position

  /// Runs `body`, then puts the row at the top of the screen back where it
  /// was, or the tail back on screen when following. `anchorShift` maps the
  /// anchor through rows inserted or removed above it.
  private func keepingPlace(anchorShift change: TranscriptSegments.Change? = nil, _ body: () -> Void) {
    let clip = scrollView.contentView
    guard !follow.atBottom, table.numberOfRows > 0 else {
      body()
      if follow.atBottom, landed { scrollToBottom() }
      return
    }
    let top = clip.bounds.minY
    // Never the strip above the history: older pages land right below it.
    let anchor = min(max(1, table.row(at: NSPoint(x: 1, y: top))), table.numberOfRows - 1)
    let anchorId = id(anchor)
    let offset = top - table.rect(ofRow: anchor).minY
    body()
    var index = anchor
    if let change, anchor - 1 >= change.removed.upperBound {
      index = anchor + change.inserted.count - change.removed.count
    } else if id(min(anchor, rowCount - 1)) != anchorId {
      index = (0..<rowCount).first { id($0) == anchorId } ?? anchor
    }
    scroll(to: table.rect(ofRow: min(index, rowCount - 1)).minY + offset)
  }

  private func scroll(to y: CGFloat) {
    let clip = scrollView.contentView
    let height = table.rect(ofRow: table.numberOfRows - 1).maxY
    if table.frame.height != height { table.tile() }
    let target = min(max(0, y), max(0, height - clip.bounds.height))
    guard abs(clip.bounds.minY - target) > 0.25 else { return }
    adjusting += 1
    clip.scroll(to: NSPoint(x: 0, y: target))
    scrollView.reflectScrolledClipView(clip)
    adjusting -= 1
  }

  /// The newest rows measured first, so the bottom is the real bottom.
  func scrollToBottom() {
    guard table.numberOfRows > 0 else { return }
    let viewport = scrollView.contentView.bounds.height
    var filled: CGFloat = 0
    var index = table.numberOfRows - 1
    var moved = IndexSet()
    while index >= 0, filled < viewport * 2 {
      moved.formUnion(measure([index]))
      filled += heights.exact(id(index), revision: revision(id(index)), width: width) ?? 0
      index -= 1
    }
    note(moved)
    scroll(to: .greatestFiniteMagnitude)
  }

  func jumpToLatest() {
    follow.atBottom = true
    scrollToBottom()
  }

  /// Brings a message's row on screen, opening its tool group first.
  func reveal(messageId: String, openGroup: Bool) {
    guard let segment = segments.segmentIndex(holding: messageId) else { return }
    let index = segment + 1
    if openGroup, case .collapsed = segments.segments[segment] {
      model.expandedGroups.insert(segments.segments[segment].id)
      heights.forget(id(index))
    }
    follow.atBottom = false
    note(measure([index], always: true))
    let rect = table.rect(ofRow: index)
    let viewport = scrollView.contentView.bounds.height
    let centred = rect.height < viewport && !openGroup
    scroll(to: centred ? rect.midY - viewport / 2 : rect.minY - 20)
    measureAroundViewport()
  }

  private var isAtBottom: Bool {
    scrollView.contentView.bounds.maxY >= table.frame.height - 40
  }

  @objc private func boundsChanged() {
    guard adjusting == 0 else { return }
    follow.atBottom = isAtBottom
    measureAroundViewport()
    loadOlderIfNeeded()
  }

  @objc private func frameChanged() {
    let width = width
    guard TranscriptRowHeights.widthKey(width) != TranscriptRowHeights.widthKey(lastWidth) else { return }
    lastWidth = width
    guard table.numberOfRows > 0 else { return }
    // Rows on screen take the new width now; the rest as they come near.
    let visible = table.rows(in: scrollView.contentView.bounds)
    let indices = IndexSet(integersIn: visible.location..<(visible.location + visible.length))
    keepingPlace { note(measure(indices).union(indices)) }
  }

  private func loadOlderIfNeeded() {
    guard top.hasOlder, !top.loading, landed else { return }
    let clip = scrollView.contentView.bounds
    // Not from inside a view update, which is where `update` runs.
    if clip.minY < clip.height * 2 { DispatchQueue.main.async { [weak self] in self?.onNeedOlder() } }
  }
}
