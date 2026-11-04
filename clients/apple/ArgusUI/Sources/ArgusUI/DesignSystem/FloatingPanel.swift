#if os(macOS)
  import AppKit
  import SwiftUI

  /// Where a floating panel hangs off its trigger; it flips when that side has no room.
  public enum FloatingPanelPlacement: Sendable {
    case below
    /// To the trigger's left, top edges aligned.
    case leading
    /// To the trigger's right, top edges aligned.
    case trailing
  }

  /// A key an interactive panel offers its content before the focused field sees it.
  public enum FloatingPanelKey: Equatable, Sendable {
    case up, down, submit
    /// Offered before Esc closes the panel, e.g. to step back out of a submenu.
    case escape
    case character(Character)
  }

  extension View {
    /// Shows `content` anchored to this view in its own borderless panel while `isPresented`.
    /// Interactive panels take the keyboard: `onKey` sees arrows, Return and plain characters
    /// first, and Esc or a click elsewhere closes. Passive ones only show, and ignore the pointer.
    /// `acceptsPointer` lets a passive panel take clicks without taking the keyboard.
    public func floatingPanel<Content: View>(
      isPresented: Binding<Bool>, placement: FloatingPanelPlacement = .below, interactive: Bool = true,
      acceptsPointer: Bool = false, onKey: ((FloatingPanelKey) -> Bool)? = nil,
      @ViewBuilder content: @escaping () -> Content
    ) -> some View {
      modifier(
        FloatingPanelModifier(
          isPresented: isPresented, placement: placement, interactive: interactive, acceptsPointer: acceptsPointer,
          onKey: onKey, content: { AnyView(content()) }))
    }
  }

  extension View {
    /// A card beside this view once the pointer rests on it; leaving hides it. A `hoverable`
    /// card also takes the pointer, staying open while it's over the card so links in it work.
    public func hoverCard(
      placement: FloatingPanelPlacement = .leading, enabled: Bool = true, hoverable: Bool = false,
      onShow: (() -> Void)? = nil, @ViewBuilder card: @escaping () -> some View
    ) -> some View {
      modifier(
        HoverCardModifier(
          placement: placement, enabled: enabled, hoverable: hoverable, onShow: onShow, card: { AnyView(card()) }))
    }
  }

  private struct HoverCardModifier: ViewModifier {
    let placement: FloatingPanelPlacement
    let enabled: Bool
    let hoverable: Bool
    let onShow: (() -> Void)?
    let card: () -> AnyView
    @State private var shown = false
    @State private var pending: Task<Void, Never>?
    @State private var overTrigger = false
    @State private var overCard = false

    func body(content: Content) -> some View {
      content
        .onHover { inside in
          overTrigger = inside
          pending?.cancel()
          guard inside, enabled else {
            hideUnlessHovered()
            return
          }
          guard !shown else { return }
          pending = Task {
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            shown = true
            onShow?()
          }
        }
        .onChange(of: enabled) { _, enabled in
          if !enabled {
            pending?.cancel()
            shown = false
          }
        }
        .floatingPanel(
          isPresented: $shown, placement: placement, interactive: false, acceptsPointer: hoverable,
          content: {
            card().onHover { inside in
              overCard = inside
              if !inside { hideUnlessHovered() }
            }
          })
    }

    /// A hoverable card gets a moment for the pointer to cross the gap from the trigger.
    private func hideUnlessHovered() {
      guard hoverable, enabled else {
        shown = false
        return
      }
      pending?.cancel()
      pending = Task {
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled, !overTrigger, !overCard else { return }
        shown = false
      }
    }
  }

  private struct FloatingPanelModifier: ViewModifier {
    @Environment(\.theme) private var theme
    @Binding var isPresented: Bool
    let placement: FloatingPanelPlacement
    let interactive: Bool
    let acceptsPointer: Bool
    let onKey: ((FloatingPanelKey) -> Bool)?
    let content: () -> AnyView

    func body(content trigger: Content) -> some View {
      trigger.background(
        FloatingPanelAnchor(
          isPresented: $isPresented, placement: placement, interactive: interactive, acceptsPointer: acceptsPointer,
          theme: theme, onKey: onKey, content: content))
    }
  }

  private struct FloatingPanelAnchor: NSViewRepresentable {
    @Binding var isPresented: Bool
    let placement: FloatingPanelPlacement
    let interactive: Bool
    let acceptsPointer: Bool
    let theme: Theme
    let onKey: ((FloatingPanelKey) -> Bool)?
    let content: () -> AnyView

    func makeCoordinator() -> FloatingPanelController { FloatingPanelController() }

    func makeNSView(context: Context) -> NSView {
      let view = NSView()
      context.coordinator.anchor = view
      return view
    }

    func updateNSView(_ view: NSView, context: Context) {
      let controller = context.coordinator
      let binding = $isPresented
      controller.placement = placement
      controller.interactive = interactive
      controller.acceptsPointer = acceptsPointer
      controller.onKey = onKey
      controller.onDismiss = { binding.wrappedValue = false }
      guard isPresented else {
        controller.dismiss(restoreFocus: interactive, notify: false)
        return
      }
      controller.setContent(content(), theme: theme)
      if !controller.isOpen {
        if controller.justDismissed {
          // The click that closed it by leaving the panel lands on the trigger; don't reopen.
          DispatchQueue.main.async { binding.wrappedValue = false }
        } else {
          DispatchQueue.main.async { controller.open() }
        }
      }
    }

    static func dismantleNSView(_ view: NSView, coordinator: FloatingPanelController) {
      coordinator.dismiss(restoreFocus: false, notify: false)
    }
  }

  private final class FloatingPanelWindow: NSPanel {
    var interactive = true
    var onKey: ((NSEvent) -> Bool)?
    var onResign: (() -> Void)?

    override var canBecomeKey: Bool { interactive }
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
  final class FloatingPanelController {
    /// Room around the content for the surface's shadow, which the panel would otherwise clip.
    private static let margin: CGFloat = 18

    weak var anchor: NSView?
    var placement: FloatingPanelPlacement = .below
    var interactive = true
    var acceptsPointer = false
    var onKey: ((FloatingPanelKey) -> Bool)?
    var onDismiss: (() -> Void)?
    private var panel: FloatingPanelWindow?
    private var hosting: NSHostingView<AnyView>?
    private var root = AnyView(EmptyView())
    private var dismissedAt = Date.distantPast
    private var keyMonitor: Any?

    var isOpen: Bool { panel != nil }
    var justDismissed: Bool { Date().timeIntervalSince(dismissedAt) < 0.3 }

    func setContent(_ content: AnyView, theme: Theme) {
      root = AnyView(
        content
          .environment(\.theme, theme)
          .environment(\.colorScheme, theme.scheme)
          .environment(\.inNonKeyWindow, acceptsPointer && !interactive)
          .fixedSize()
          .onGeometryChange(for: CGSize.self, of: \.size) { [weak self] _ in
            DispatchQueue.main.async { self?.layout() }
          }
          .padding(Self.margin))
      hosting?.rootView = root
    }

    func open() {
      guard panel == nil, let anchor, let window = anchor.window else {
        onDismiss?()
        return
      }
      let panel = FloatingPanelWindow(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
      panel.interactive = interactive
      panel.isOpaque = false
      panel.backgroundColor = .clear
      panel.hasShadow = false
      panel.isReleasedWhenClosed = false
      panel.animationBehavior = .none
      panel.ignoresMouseEvents = !interactive && !acceptsPointer
      panel.appearance = window.effectiveAppearance
      panel.onKey = { [weak self] event in self?.handle(event) ?? false }
      if interactive {
        panel.onResign = { [weak self] in self?.dismiss(restoreFocus: false, notify: true) }
      }
      let hosting = NSHostingView(rootView: root)
      panel.contentView = hosting
      self.panel = panel
      self.hosting = hosting
      layout()
      window.addChildWindow(panel, ordered: .above)
      if interactive {
        panel.makeKeyAndOrderFront(nil)
        // Synthetic keys to an inactive app land on the main window; the open menu gets them first.
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
          let handled = MainActor.assumeIsolated {
            guard let self, !NSApp.isActive, event.window !== self.panel else { return false }
            return self.handle(event)
          }
          return handled ? nil : event
        }
      } else {
        panel.orderFront(nil)
      }
    }

    func dismiss(restoreFocus: Bool, notify: Bool) {
      guard let panel else { return }
      self.panel = nil
      hosting = nil
      if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
      keyMonitor = nil
      panel.onResign = nil
      let parent = panel.parent
      parent?.removeChildWindow(panel)
      panel.orderOut(nil)
      if interactive { dismissedAt = Date() }
      if restoreFocus, let parent, parent.isVisible { parent.makeKey() }
      if notify { onDismiss?() }
    }

    /// Hangs the panel off the trigger, on the other side when the preferred one has no room.
    func layout() {
      guard let panel, let hosting, let anchor, let window = anchor.window else { return }
      let rect = window.convertToScreen(anchor.convert(anchor.bounds, to: nil))
      let screen = (window.screen ?? NSScreen.main)?.visibleFrame ?? rect.insetBy(dx: -1000, dy: -1000)
      let size = hosting.fittingSize
      let margin = Self.margin
      let content = CGSize(width: size.width - margin * 2, height: size.height - margin * 2)
      let gap: CGFloat = 4
      // The content's own frame; the panel adds the shadow margin around it.
      var frame: CGRect
      switch placement {
      case .below:
        let below = rect.minY - gap - content.height
        frame = CGRect(origin: CGPoint(x: rect.minX, y: below >= screen.minY ? below : rect.maxY + gap), size: content)
      case .leading:
        let left = rect.minX - 12 - content.width
        frame = CGRect(
          origin: CGPoint(x: left >= screen.minX ? left : rect.maxX + 12, y: rect.maxY - content.height), size: content)
      case .trailing:
        let right = rect.maxX + 12
        frame = CGRect(
          origin: CGPoint(
            x: right + content.width <= screen.maxX ? right : rect.minX - 12 - content.width,
            y: rect.maxY - content.height),
          size: content)
      }
      frame.origin.x = min(max(frame.minX, screen.minX + 4), screen.maxX - content.width - 4)
      frame.origin.y = min(max(frame.minY, screen.minY + 4), screen.maxY - content.height - 4)
      let origin = CGPoint(x: frame.minX - margin, y: frame.minY - margin)
      panel.setFrame(NSRect(origin: origin, size: size), display: true)
    }

    private func handle(_ event: NSEvent) -> Bool {
      let key: FloatingPanelKey
      switch event.keyCode {
      case 53:  // Esc
        if onKey?(.escape) != true { dismiss(restoreFocus: true, notify: true) }
        return true
      case 125: key = .down
      case 126: key = .up
      case 36, 76: key = .submit
      default:
        let modifiers = event.modifierFlags.intersection([.command, .control, .option])
        guard modifiers.isEmpty, let typed = event.charactersIgnoringModifiers?.first else { return false }
        key = .character(typed)
      }
      return onKey?(key) ?? false
    }
  }
#endif
