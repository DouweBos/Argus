import PDFKit
import SwiftUI

/// Which page is showing and how far it's zoomed, shared by the PDF view and its controls.
@MainActor
@Observable
public final class PDFViewerState {
  public private(set) var pageIndex = 0
  public private(set) var pageCount = 0
  @ObservationIgnored fileprivate weak var view: PDFView?

  public init() {}

  public var canGoBack: Bool { pageIndex > 0 }
  public var canGoForward: Bool { pageIndex < pageCount - 1 }

  public func go(to index: Int) {
    guard let view, let page = view.document?.page(at: min(max(index, 0), max(pageCount - 1, 0))) else { return }
    view.go(to: page)
  }

  public func zoom(by factor: CGFloat) {
    guard let view else { return }
    view.autoScales = false
    view.scaleFactor = min(max(view.scaleFactor * factor, view.minScaleFactor), view.maxScaleFactor)
  }

  public func fit() {
    view?.autoScales = true
  }

  fileprivate func sync() {
    guard let view, let document = view.document else { return }
    pageCount = document.pageCount
    if let page = view.currentPage { pageIndex = document.index(for: page) }
  }
}

/// A PDF, pages stacked and scrolled, with page and zoom controls along the top.
/// Pinch or ⌘± zoom too; the controls are for a mouse and for finding your place.
public struct PDFDocumentView: View {
  @Environment(\.theme) private var theme
  let document: PDFDocument
  @State private var state = PDFViewerState()

  public init(document: PDFDocument) {
    self.document = document
  }

  public var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 2) {
        IconBtn(systemName: "chevron.up", label: "Previous Page", size: 12) { state.go(to: state.pageIndex - 1) }
          .disabled(!state.canGoBack)
        IconBtn(systemName: "chevron.down", label: "Next Page", size: 12) { state.go(to: state.pageIndex + 1) }
          .disabled(!state.canGoForward)
        Text(state.pageCount == 0 ? "" : "Page \(state.pageIndex + 1) of \(state.pageCount)")
          .font(.scaled(size: 11).monospacedDigit())
          .foregroundStyle(theme.textSecondary)
          .padding(.leading, 4)
        Spacer()
        IconBtn(systemName: "minus.magnifyingglass", label: "Zoom Out", size: 12) { state.zoom(by: 1 / 1.25) }
        IconBtn(systemName: "arrow.up.left.and.down.right.magnifyingglass", label: "Fit Width", size: 12) {
          state.fit()
        }
        IconBtn(systemName: "plus.magnifyingglass", label: "Zoom In", size: 12) { state.zoom(by: 1.25) }
      }
      .padding(.horizontal, 8)
      .frame(height: 32)
      Rectangle().fill(theme.border).frame(height: 1)
      PDFKitView(document: document, state: state, background: theme.bgSecondary)
    }
  }
}

#if os(iOS)
  private struct PDFKitView: UIViewRepresentable {
    let document: PDFDocument
    let state: PDFViewerState
    let background: Color

    func makeCoordinator() -> PDFPageObserver { PDFPageObserver(state: state) }

    func makeUIView(context: Context) -> PDFView {
      let view = PDFView()
      configure(view, observer: context.coordinator)
      return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
      if view.document !== document { view.document = document }
      view.backgroundColor = UIColor(background)
    }
  }
#else
  private struct PDFKitView: NSViewRepresentable {
    let document: PDFDocument
    let state: PDFViewerState
    let background: Color

    func makeCoordinator() -> PDFPageObserver { PDFPageObserver(state: state) }

    func makeNSView(context: Context) -> PDFView {
      let view = PDFView()
      configure(view, observer: context.coordinator)
      return view
    }

    func updateNSView(_ view: PDFView, context: Context) {
      if view.document !== document { view.document = document }
      view.backgroundColor = NSColor(background)
    }
  }
#endif

extension PDFKitView {
  fileprivate func configure(_ view: PDFView, observer: PDFPageObserver) {
    view.displayMode = .singlePageContinuous
    view.displayDirection = .vertical
    view.autoScales = true
    view.document = document
    state.view = view
    let center = NotificationCenter.default
    center.addObserver(observer, selector: #selector(PDFPageObserver.changed), name: .PDFViewPageChanged, object: view)
    center.addObserver(observer, selector: #selector(PDFPageObserver.changed), name: .PDFViewDocumentChanged, object: view)
    state.sync()
  }
}

/// Selector-based, so it stops observing when SwiftUI drops the view.
@MainActor
final class PDFPageObserver: NSObject {
  let state: PDFViewerState
  init(state: PDFViewerState) { self.state = state }
  @objc func changed() { state.sync() }
}
