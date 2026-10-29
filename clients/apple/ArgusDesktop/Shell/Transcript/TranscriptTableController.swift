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
  let selection = TranscriptSelection()
  /// The reader neared the top and the host has older pages.
  var onNeedOlder: () -> Void = {}

  let scrollView = TranscriptScrollView()
  let table = TranscriptTableView()
  /// Measures a hosted row whose cell reports no height.
  private let sizer = NSHostingController(rootView: AnyView(EmptyView()))
  /// Where hosted rows are built before they scroll in: hidden, in the table's
  /// own window, so joining a row changes nothing SwiftUI depends on.
  let staging = NSView(frame: NSRect(x: -100_000, y: 0, width: 1, height: 1))
  var prepared = PreparedCells()
  var prefetchLink: CADisplayLink?
  /// Hosted rows laying out to be measured, whose heights `measure` stores itself.
  var measuring = 0
  /// Which way the reader last scrolled; prefetch looks further that way.
  var scrollingUp = true
  var lastHostedBuild: CFTimeInterval = 0
  private var lastOffset: CGFloat = 0

  private(set) var agentKey = ""
  private var segments = TranscriptSegments(folding: .turns)
  private var revisions: [String: Int] = [:]
  private var top = TranscriptRow.TopState()
  private var footer = TranscriptRow.FooterState()
  private(set) var environment = EnvironmentValues()
  /// What the reading column keeps clear of: the pane's context card.
  var reserve: CGFloat { environment.readingColumnReserve }
  private(set) var environmentKey = ""
  var heights = TranscriptRowHeights()
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
    staging.isHidden = true
    table.addSubview(staging)
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
    wireSelection()
    scrollView.onScrollUp = { [weak self] in self?.follow.atBottom = false }
    wheelMonitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
      // Delivered on the main thread, with the event being dispatched.
      nonisolated(unsafe) let event = event
      let redirected = MainActor.assumeIsolated {
        self?.noteWheel(event)
        return self?.scrollView.takeWheel(event) == true
      }
      return redirected ? nil : event
    }
  }

  deinit {
    if let wheelMonitor { NSEvent.removeMonitor(wheelMonitor) }
  }

  // MARK: Rows

  var rowCount: Int { segments.segments.count + 2 }

  func row(_ index: Int) -> TranscriptRow {
    if index == 0 { return .top(top) }
    if index == rowCount - 1 { return .footer(footer) }
    let segment = segments.segments[index - 1]
    if case .collapsed(let messages) = segment { return .work(workLog(index - 1, messages)) }
    return .segment(segment)
  }

  /// A work log's span reads its neighbours: the message before it, and the reply after.
  private func workLog(_ position: Int, _ messages: [RemoteMessage]) -> TranscriptRow.WorkLog {
    let all = segments.segments
    let before = position > 0 ? all[position - 1].messages.last?.timestamp : nil
    var ended: Double?
    if position + 1 < all.count, let next = all[position + 1].messages.first {
      ended = next.role == .assistant ? next.timestamp : messages.last?.timestamp
    }
    let running = BackgroundTasks.running(in: turn(from: position).flatMap(\.messages))
    return .init(
      id: all[position].id, messages: messages, started: before, ended: ended,
      stillRunning: BackgroundTasks.stillRunningLabel(running))
  }

  /// The segments from `position` to the end of its turn: the reply after the
  /// log is where a background launch usually sits.
  private func turn(from position: Int) -> ArraySlice<ToolGroups.Segment> {
    let all = segments.segments
    var end = position + 1
    while end < all.count, !Self.startsTurn(all[end]) { end += 1 }
    return all[position..<end]
  }

  private static func startsTurn(_ segment: ToolGroups.Segment) -> Bool {
    guard case .single(let message) = segment else { return false }
    return message.role != .assistant
  }

  /// A work log next to an inserted or removed row has a new span to show, and
  /// one whose turn changed may have new background work to count.
  private func withNeighbouringLogs(_ change: TranscriptSegments.Change) -> TranscriptSegments.Change {
    var change = withTurnLogs(change)
    guard !change.removed.isEmpty || !change.inserted.isEmpty else { return change }
    for index in [change.inserted.lowerBound - 1, change.inserted.upperBound]
    where segments.segments.indices.contains(index) && !change.inserted.contains(index)
      && !change.reloaded.contains(index)
    {
      if case .collapsed = segments.segments[index] { change.reloaded.append(index) }
    }
    return change
  }

  /// The work log opening each changed segment's turn.
  private func withTurnLogs(_ change: TranscriptSegments.Change) -> TranscriptSegments.Change {
    let all = segments.segments
    var change = change
    for index in change.reloaded + Array(change.inserted) {
      var log = index - 1
      while log >= 0, !Self.startsTurn(all[log]) {
        if case .collapsed = all[log] {
          if !change.inserted.contains(log) && !change.reloaded.contains(log) { change.reloaded.append(log) }
          break
        }
        log -= 1
      }
    }
    return change
  }

  func id(_ index: Int) -> String {
    if index == 0 { return "top" }
    if index == rowCount - 1 { return "footer" }
    return segments.segments[index - 1].id
  }

  func revision(_ id: String) -> Int { revisions[id] ?? 0 }

  /// What the sizer measures.
  private func root(_ index: Int) -> AnyView {
    TranscriptRow.root(
      row(index), id: nil, agentKey: agentKey, model: model, selection: selection, environment: environment)
  }

  var width: CGFloat { max(scrollView.contentView.bounds.width, 1) }

  /// A message that is only text — no badges, attachments or tool calls — and
  /// so can be drawn by a plain AppKit text cell.
  func plainText(_ index: Int) -> (RemoteMessage, TranscriptRendered)? {
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
    let change = withNeighbouringLogs(segments.update(messages))
    if !change.isEmpty { messageOrder = nil }
    let topChanged = top != self.top
    let footerChanged = footer != self.footer
    self.top = top
    self.footer = footer
    guard !change.isEmpty || topChanged || footerChanged || restyled else { return }

    TranscriptPerfLog.time("update +\(change.inserted.count) -\(change.removed.count) ~\(change.reloaded.count)") {
      apply(change, topChanged: topChanged, footerChanged: footerChanged, restyled: restyled, empty: messages.isEmpty)
    }
  }

  private func apply(
    _ change: TranscriptSegments.Change, topChanged: Bool, footerChanged: Bool, restyled: Bool, empty: Bool
  ) {
    let wasEmpty = table.numberOfRows == 0
    // The first page lands hidden and shows on the next turn, so building its
    // rows and drawing them are two passes rather than one long one.
    if !landed, !empty {
      table.isHidden = true
      DispatchQueue.main.async { [weak self] in self?.table.isHidden = false }
    }
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
        forgetPrepared()
        changed = IndexSet(integersIn: 0..<rowCount)
      }
      for index in changed { configureVisibleCell(index) }
      measure(changed.filter(isNearViewport), always: true)
      note(changed)
      // A message just sent or streamed in lands below the viewport, then
      // scrolls in: measured now, it never draws at the estimate.
      if !wasEmpty, (1...4).contains(change.inserted.count) {
        note(measure((change.inserted.lowerBound + 1)..<(change.inserted.upperBound + 1)))
      }
    }
    if !landed, !empty {
      landed = true
      scrollToBottom()
    }
    measureAroundViewport()
    loadOlderIfNeeded()
  }

  private func reset(_ key: String) {
    agentKey = key
    segments = TranscriptSegments(folding: .turns)
    revisions = [:]
    heights = TranscriptRowHeights()
    forgetPrepared()
    landed = false
    follow.atBottom = true
    messageOrder = nil
    selection.clear()
    if table.numberOfRows > 0 { instantly { table.reloadData() } }
  }

  /// What a hosted row looks like depends on these beyond the row itself.
  private static func environmentKey(_ environment: EnvironmentValues) -> String {
    let links = environment.transcriptLinks.map { "\(ObjectIdentifier($0))" } ?? "-"
    return
      "\(environment.colorScheme)|\(environment.dynamicTypeSize)|\(TextScale.shared.factor)|\(links)|\(environment.readingColumnReserve)"
  }

  // MARK: Selection

  private var messageOrder: [String: Int]?

  private func order(_ messageId: String) -> Int? {
    if messageOrder == nil {
      messageOrder = Dictionary(
        segments.messages.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
    }
    return messageOrder?[messageId]
  }

  private func wireSelection() {
    table.textSelection = selection
    selection.order = { [weak self] in self?.order($0) }
    selection.text = { [weak self] id in
      guard let self, let index = self.order(id) else { return nil }
      return self.model.text(for: self.segments.messages[index])?.string
    }
    selection.unitsBetween = { [weak self] first, last in
      guard let self, first <= last, last < self.segments.messages.count else { return [] }
      return self.segments.messages[first...last]
        .filter { !TranscriptModel.textBlocks($0).isEmpty }
        .map(\.id)
    }
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
  func measure(_ indices: some Sequence<Int>, always: Bool = false) -> IndexSet {
    var moved = IndexSet()
    let width = width
    for index in indices {
      let id = id(index)
      let revision = revision(id)
      if always || heights.exact(id, revision: revision, width: width) == nil {
        let height: CGFloat
        if let (_, text) = plainText(index) {
          height = TranscriptPerfLog.time("measure.text") {
            TranscriptTextCell.height(of: text, width: width, reserve: reserve)
          }
        } else {
          height = TranscriptPerfLog.time("measure.\(kind(index))") {
            if let laidOut = layOutHosted(index, width: width) { return ceil(laidOut) }
            sizer.rootView = root(index)
            let size = sizer.sizeThatFits(in: CGSize(width: width, height: .greatestFiniteMagnitude))
            return size.height.isFinite ? ceil(size.height) : 40
          }
        }
        heights.store(id, revision: revision, width: width, height: height)
      }
      if heights.exact(id, revision: revision, width: width) != heights.reported[id] { moved.insert(index) }
    }
    return moved
  }

  func note(_ indices: IndexSet) {
    guard !indices.isEmpty else { return }
    instantly { table.noteHeightOfRows(withIndexesChanged: indices) }
  }

  /// The rows on screen are measured before they draw. Two screens above and
  /// one below follow a row per run-loop turn, nearest first and upward first
  /// (where a reader of history is heading), so scrolling into them shifts
  /// nothing and no single pass measures a screenful.
  private func measureAroundViewport() {
    guard table.numberOfRows > 0 else { return }
    let visible = table.rows(in: scrollView.contentView.bounds)
    var indices = Array(visible.location..<(visible.location + visible.length))
    // Mid-resize, hosted rows report the height they lay out at themselves.
    if CACurrentMediaTime() - widthChangedAt < 0.3 { indices = indices.filter { plainText($0) != nil } }
    let moved = measure(indices)
    if !moved.isEmpty { keepingPlace { note(moved) } }
    schedulePrefetch()
  }

  /// A hosted row laid out at a height the table doesn't have: it resized
  /// itself, or was measured before an image or a form arrived. Applied once
  /// this layout pass is over, all together.
  func rowLaidOut(_ id: String, revision: Int, height: CGFloat) {
    guard measuring == 0, revision == self.revision(id), height.isFinite, height > 0 else { return }
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
  func keepingPlace(anchorShift change: TranscriptSegments.Change? = nil, _ body: () -> Void) {
    instantly { keepingPlaceNow(anchorShift: change, body) }
  }

  private func keepingPlaceNow(anchorShift change: TranscriptSegments.Change?, _ body: () -> Void) {
    let clip = scrollView.contentView
    guard !follow.atBottom, table.numberOfRows > 0 else {
      body()
      if follow.atBottom, landed { scrollToBottom() }
      return
    }
    let top = clip.bounds.minY
    // The first row that starts on screen, so a row cut off at the top that
    // changes height grows upward, out of sight. Never the strip above the
    // history: older pages land right below it.
    var anchor = table.row(at: NSPoint(x: 1, y: top))
    if anchor >= 0, table.rect(ofRow: anchor).minY < top, anchor + 1 < table.numberOfRows,
      table.rect(ofRow: anchor + 1).minY < clip.bounds.maxY
    {
      anchor += 1
    }
    anchor = min(max(1, anchor), table.numberOfRows - 1)
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

  /// The newest screenful measured first, so the bottom is the real bottom;
  /// prefetch measures what's above.
  func scrollToBottom() {
    guard table.numberOfRows > 0 else { return }
    let viewport = scrollView.contentView.bounds.height
    var filled: CGFloat = 0
    var index = table.numberOfRows - 1
    var moved = IndexSet()
    while index >= 0, filled < viewport {
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

  private func distanceFromBottom() -> CGFloat {
    table.frame.height - scrollView.contentView.bounds.maxY
  }

  /// A wheel toward older messages stops following at once, however close to
  /// the bottom: otherwise the next streamed row snaps the reader back down.
  /// The monitor sees a gesture that a sideways block redirects, too.
  private func noteWheel(_ event: NSEvent) {
    guard event.scrollingDeltaY > 0.5, let window = scrollView.window, event.window === window,
      scrollView.bounds.contains(scrollView.convert(event.locationInWindow, from: nil))
    else { return }
    follow.atBottom = false
  }

  @objc private func boundsChanged() {
    guard adjusting == 0 else { return }
    TranscriptPerfLog.time("boundsChanged") { boundsChangedNow() }
  }

  private func boundsChangedNow() {
    let offset = scrollView.contentView.bounds.minY
    if offset != lastOffset { scrollingUp = offset < lastOffset }
    lastOffset = offset
    // Following ends a little way up; it resumes only at the very bottom.
    if follow.atBottom {
      if distanceFromBottom() > 40 { follow.atBottom = false }
    } else if distanceFromBottom() <= 2 {
      follow.atBottom = true
    }
    measureAroundViewport()
    loadOlderIfNeeded()
  }

  @objc private func frameChanged() {
    let width = width
    guard TranscriptRowHeights.widthKey(width) != TranscriptRowHeights.widthKey(lastWidth) else { return }
    lastWidth = width
    widthChangedAt = CACurrentMediaTime()
    guard table.numberOfRows > 0 else { return }
    // Text rows on screen take the new width now. Hosted ones lay out at it in
    // their cells and report their height; the rest follow as they come near.
    let visible = table.rows(in: scrollView.contentView.bounds)
    let indices = IndexSet(integersIn: visible.location..<(visible.location + visible.length))
    keepingPlace { note(measure(indices.filter { plainText($0) != nil }).union(indices)) }
  }

  private(set) var widthChangedAt: CFTimeInterval = 0

  private func loadOlderIfNeeded() {
    guard top.hasOlder, !top.loading, landed else { return }
    let clip = scrollView.contentView.bounds
    // Not from inside a view update, which is where `update` runs.
    if clip.minY < clip.height * 2 { DispatchQueue.main.async { [weak self] in self?.onNeedOlder() } }
  }
}
