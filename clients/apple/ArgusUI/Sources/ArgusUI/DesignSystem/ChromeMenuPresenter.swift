#if os(macOS)
  import AppKit
  import SwiftUI

  /// Which side of its trigger a dropdown prefers; it flips when that side has no room.
  public enum ChromeMenuEdge: Sendable {
    case below
    case above
  }

  extension View {
    /// Shows a dropdown anchored to this view, at least as wide as it, while `isPresented`.
    /// ↑↓ move, Return or a row's letter picks, Esc or a click elsewhere closes.
    public func chromeMenu(
      isPresented: Binding<Bool>, edge: ChromeMenuEdge = .below,
      @ChromeMenuBuilder entries: @escaping () -> [ChromeMenuEntry]
    ) -> some View {
      modifier(ChromeMenuModifier(isPresented: isPresented, edge: edge, entries: entries))
    }
  }

  /// A trigger that opens a dropdown: on click, or, given a primary action, on a long press.
  public struct ChromeMenuButton<Label: View>: View {
    @State private var internalOpen = false
    @State private var suppressTap = false
    private let external: Binding<Bool>?
    private let edge: ChromeMenuEdge
    private let primaryAction: (() -> Void)?
    private let entries: () -> [ChromeMenuEntry]
    private let label: (_ isOpen: Bool) -> Label

    public init(
      isPresented: Binding<Bool>? = nil, edge: ChromeMenuEdge = .below, primaryAction: (() -> Void)? = nil,
      @ChromeMenuBuilder entries: @escaping () -> [ChromeMenuEntry],
      @ViewBuilder label: @escaping (_ isOpen: Bool) -> Label
    ) {
      self.external = isPresented
      self.edge = edge
      self.primaryAction = primaryAction
      self.entries = entries
      self.label = label
    }

    public var body: some View {
      let open = external ?? $internalOpen
      Button {
        if suppressTap {
          suppressTap = false
        } else if let primaryAction {
          primaryAction()
        } else {
          open.wrappedValue = true
        }
      } label: {
        label(open.wrappedValue)
      }
      .simultaneousGesture(
        LongPressGesture(minimumDuration: 0.4).onEnded { _ in
          suppressTap = true
          open.wrappedValue = true
        },
        including: primaryAction == nil ? .subviews : .all
      )
      .onChange(of: open.wrappedValue) { _, isOpen in
        if !isOpen { suppressTap = false }
      }
      .chromeMenu(isPresented: open, edge: edge, entries: entries)
    }
  }

  /// A context card row that does one thing on click, with a chevron dropdown of the rest.
  public struct ContextSplitRow<Row: View>: View {
    @Environment(\.theme) private var theme
    @State private var open = false
    let action: () -> Void
    let row: Row
    let menu: () -> [ChromeMenuEntry]

    public init(
      action: @escaping () -> Void, @ViewBuilder row: () -> Row,
      @ChromeMenuBuilder menu: @escaping () -> [ChromeMenuEntry]
    ) {
      self.action = action
      self.row = row()
      self.menu = menu
    }

    public var body: some View {
      HStack(spacing: 0) {
        Button(action: action) { row }
          .buttonStyle(ContextRowButtonStyle(selected: open))
        Button {
          open = true
        } label: {
          Image(systemName: Icon.chevronDown)
            .font(.scaled(size: 9, weight: .semibold))
            .foregroundStyle(open ? theme.text : theme.textSecondary)
            .frame(width: TextScale.shared(22), height: TextScale.shared(26))
            .contentShape(.rect)
        }
        .buttonStyle(ContextRowButtonStyle(selected: open))
        .accessibilityLabel("More")
      }
      .chromeMenu(isPresented: $open, entries: menu)
    }
  }

  // MARK: - Presentation

  private struct ChromeMenuModifier: ViewModifier {
    @Environment(\.theme) private var theme
    @Binding var isPresented: Bool
    let edge: ChromeMenuEdge
    let entries: () -> [ChromeMenuEntry]

    func body(content: Content) -> some View {
      content.background(
        ChromeMenuAnchor(isPresented: $isPresented, edge: edge, theme: theme, entries: entries))
    }
  }

  /// An invisible view behind the trigger: where the panel hangs from, and its owner.
  private struct ChromeMenuAnchor: NSViewRepresentable {
    @Binding var isPresented: Bool
    let edge: ChromeMenuEdge
    let theme: Theme
    let entries: () -> [ChromeMenuEntry]

    func makeCoordinator() -> ChromeMenuController { ChromeMenuController() }

    func makeNSView(context: Context) -> NSView {
      let view = NSView()
      context.coordinator.anchor = view
      return view
    }

    func updateNSView(_ view: NSView, context: Context) {
      let controller = context.coordinator
      let binding = $isPresented
      controller.edge = edge
      controller.theme = theme
      controller.onDismiss = { binding.wrappedValue = false }
      guard isPresented else {
        controller.dismiss(restoreFocus: false, notify: false)
        return
      }
      controller.model.entries = ChromeMenuEntry.tidy(entries())
      if controller.isOpen {
        controller.layout()
      } else if controller.justDismissed {
        // The click that closed it by leaving the panel lands on the trigger; don't reopen.
        DispatchQueue.main.async { binding.wrappedValue = false }
      } else {
        DispatchQueue.main.async { controller.open() }
      }
    }

    static func dismantleNSView(_ view: NSView, coordinator: ChromeMenuController) {
      coordinator.dismiss(restoreFocus: false, notify: false)
    }
  }

  private final class ChromeMenuPanel: NSPanel {
    var onKey: ((NSEvent) -> Bool)?
    var onResign: (() -> Void)?

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func sendEvent(_ event: NSEvent) {
      if event.type == .keyDown, onKey?(event) == true { return }
      super.sendEvent(event)
    }

    override func resignKey() {
      super.resignKey()
      onResign?()
    }
  }

  @MainActor
  final class ChromeMenuController {
    let model = ChromeMenuModel()
    weak var anchor: NSView?
    var edge: ChromeMenuEdge = .below
    var theme: Theme = .dark
    var onDismiss: (() -> Void)?
    private var panel: ChromeMenuPanel?
    private var hosting: NSHostingView<AnyView>?
    private var dismissedAt = Date.distantPast

    var isOpen: Bool { panel != nil }
    var justDismissed: Bool { Date().timeIntervalSince(dismissedAt) < 0.3 }

    func open() {
      guard panel == nil, let anchor, let window = anchor.window else {
        onDismiss?()
        return
      }
      let panel = ChromeMenuPanel(contentRect: .zero, styleMask: [.borderless], backing: .buffered, defer: false)
      panel.isOpaque = false
      panel.backgroundColor = .clear
      panel.hasShadow = true
      panel.isReleasedWhenClosed = false
      panel.animationBehavior = .none
      panel.appearance = window.effectiveAppearance
      panel.onKey = { [weak self] event in self?.handle(event) ?? false }
      panel.onResign = { [weak self] in self?.dismiss(restoreFocus: false, notify: true) }
      let hosting = NSHostingView(rootView: AnyView(EmptyView()))
      panel.contentView = hosting
      self.panel = panel
      self.hosting = hosting
      model.highlighted = nil
      layout()
      window.addChildWindow(panel, ordered: .above)
      panel.makeKeyAndOrderFront(nil)
    }

    func dismiss(restoreFocus: Bool, notify: Bool) {
      guard let panel else { return }
      self.panel = nil
      hosting = nil
      panel.onResign = nil
      let parent = panel.parent
      parent?.removeChildWindow(panel)
      panel.orderOut(nil)
      dismissedAt = Date()
      if restoreFocus, let parent, parent.isVisible { parent.makeKey() }
      if notify { onDismiss?() }
    }

    /// Sizes the panel to its rows and hangs it off the trigger, scrolling when the screen is too short.
    func layout() {
      guard let panel, let hosting, let anchor, let window = anchor.window else { return }
      let rect = window.convertToScreen(anchor.convert(anchor.bounds, to: nil))
      let screen = (window.screen ?? NSScreen.main)?.visibleFrame ?? rect.insetBy(dx: -1000, dy: -1000)
      let gap: CGFloat = 4
      let below = rect.minY - gap - screen.minY - 8
      let above = screen.maxY - rect.maxY - gap - 8

      hosting.rootView = root(minWidth: rect.width, scrollHeight: nil)
      var size = hosting.fittingSize
      let fitsPreferred = size.height <= (edge == .below ? below : above)
      let placeBelow = fitsPreferred ? edge == .below : below >= above
      let room = max(80, placeBelow ? below : above)
      if size.height > room {
        hosting.rootView = root(minWidth: size.width, scrollHeight: room - 8)
        size = NSSize(width: size.width, height: room)
      }
      let x = min(max(rect.minX, screen.minX + 4), screen.maxX - size.width - 4)
      let y = placeBelow ? rect.minY - gap - size.height : rect.maxY + gap
      panel.setFrame(NSRect(x: x, y: y, width: size.width, height: size.height), display: true)
      panel.invalidateShadow()
    }

    private func root(minWidth: CGFloat, scrollHeight: CGFloat?) -> AnyView {
      AnyView(
        ChromeMenuView(model: model, minWidth: minWidth, scrollHeight: scrollHeight) { [weak self] item in
          self?.pick(item)
        }
        .environment(\.theme, theme)
      )
    }

    private func pick(_ item: ChromeMenuItem) {
      guard !item.disabled else { return }
      if item.keepsOpen {
        item.action()
        return
      }
      dismiss(restoreFocus: true, notify: true)
      item.action()
    }

    private func handle(_ event: NSEvent) -> Bool {
      switch event.keyCode {
      case 125:  // ↓
        model.move(1)
      case 126:  // ↑
        model.move(-1)
      case 36, 76:  // Return, Enter
        if let item = model.highlightedItem { pick(item) }
      case 53:  // Esc
        dismiss(restoreFocus: true, notify: true)
      default:
        let modifiers = event.modifierFlags.intersection([.command, .control, .option])
        guard modifiers.isEmpty, let typed = event.charactersIgnoringModifiers?.first,
          let item = model.item(forKey: typed)
        else { return false }
        pick(item)
      }
      return true
    }
  }
#endif
