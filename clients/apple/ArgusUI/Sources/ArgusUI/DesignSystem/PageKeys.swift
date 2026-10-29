#if os(macOS)
  import AppKit
  import SwiftUI

  extension View {
    /// Single-letter shortcuts for the page this view is on, like Linear's: only while its window
    /// is key and nobody is typing in a field. Return true from `perform` to swallow the key.
    public func pageKeys(enabled: Bool = true, perform: @escaping (Character) -> Bool) -> some View {
      background(PageKeysMonitor(enabled: enabled, perform: perform))
    }
  }

  private struct PageKeysMonitor: NSViewRepresentable {
    let enabled: Bool
    let perform: (Character) -> Bool

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> NSView {
      let view = NSView()
      context.coordinator.view = view
      return view
    }

    func updateNSView(_ view: NSView, context: Context) {
      context.coordinator.perform = enabled ? perform : nil
    }

    static func dismantleNSView(_ view: NSView, coordinator: Coordinator) {
      coordinator.stop()
    }

    @MainActor
    final class Coordinator {
      weak var view: NSView?
      var perform: ((Character) -> Bool)?
      private var monitor: Any?

      init() {
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
          let handled = MainActor.assumeIsolated { self?.handle(event) == true }
          return handled ? nil : event
        }
      }

      func stop() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
      }

      private func handle(_ event: NSEvent) -> Bool {
        guard let perform, let window = view?.window, event.window === window,
          // An inactive app only gets synthetic keys (UI automation), which AppKit hands the main window.
          window.isKeyWindow || !NSApp.isActive,
          !(window.firstResponder is NSText),
          event.modifierFlags.intersection([.command, .control, .option]).isEmpty,
          let typed = event.charactersIgnoringModifiers?.lowercased().first
        else { return false }
        return perform(typed)
      }
    }
  }
#endif
