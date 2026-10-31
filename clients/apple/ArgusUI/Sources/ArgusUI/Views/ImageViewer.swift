import ArgusCore
import SwiftUI

#if canImport(UIKit)
  import UIKit
#endif

/// One full-screen image presenter for the whole app, so any transcript image
/// can open without threading modal state through every view between.
///
/// Holds image *ids* rather than decoded images: a message can carry several
/// and only the tapped one is guaranteed to be loaded, so the pager resolves
/// its neighbours from the store as you reach them.
@MainActor
@Observable
public final class ImageViewerState {
  public private(set) var agentKey = ""
  public private(set) var imageIds: [String] = []
  public var current: String?

  public init() {}

  public var isPresented: Bool { current != nil }

  public func present(agentKey: String, imageIds: [String], at index: Int) {
    guard imageIds.indices.contains(index) else { return }
    // A keyboard left standing behind a full-screen image is both pointless
    // and in the way of the dismiss gesture.
    dismissKeyboard()
    self.agentKey = agentKey
    self.imageIds = imageIds
    self.current = imageIds[index]
  }

  public func dismiss() {
    current = nil
    imageIds = []
  }

  public var currentIndex: Int? {
    current.flatMap { imageIds.firstIndex(of: $0) }
  }

  /// "2 of 3", or nil for a lone image.
  public var positionLabel: String? {
    guard imageIds.count > 1, let index = currentIndex else { return nil }
    return "\(index + 1) of \(imageIds.count)"
  }

  /// Step to the next image, wrapping; false when there is nowhere to go.
  @discardableResult
  public func next() -> Bool { page(by: 1) }

  @discardableResult
  public func previous() -> Bool { page(by: -1) }

  private func page(by step: Int) -> Bool {
    guard imageIds.count > 1, let index = currentIndex else { return false }
    current = imageIds[(index + step + imageIds.count) % imageIds.count]
    return true
  }
}

/// Pinch, double-tap, pan, swipe down to dismiss, and swipe across to page.
/// Copy and Share act on the image on screen; Share covers Save to Photos.
public struct ImageViewerOverlay: View {
  public enum Action: String, Sendable { case copy, share }

  @Environment(ImageViewerState.self) private var viewer
  @Environment(HostStore.self) private var host
  @State private var zoomed = false
  @State private var dismissProgress: CGFloat = 0

  public var body: some View {
    if viewer.isPresented {
      @Bindable var viewer = viewer

      ZStack {
        Color.black.opacity(1 - dismissProgress).ignoresSafeArea()

        GeometryReader { geometry in
          ScrollView(.horizontal) {
            LazyHStack(spacing: 0) {
              ForEach(viewer.imageIds, id: \.self) { imageId in
                ZoomableImagePage(
                  agentKey: viewer.agentKey,
                  imageId: imageId,
                  isCurrent: viewer.current == imageId,
                  onZoomChange: { zoomed = $0 },
                  onDismissProgress: { dismissProgress = $0 },
                  onDismiss: close)
                .frame(width: geometry.size.width, height: geometry.size.height)
                .id(imageId)
              }
            }
            .scrollTargetLayout()
          }
          .scrollTargetBehavior(.paging)
          .scrollPosition(id: $viewer.current)
          // A zoomed page owns the horizontal axis, or panning would flick to
          // the next image instead of moving within this one.
          .scrollDisabled(zoomed)
          .scrollIndicators(.hidden)
        }
        .ignoresSafeArea()

        VStack {
          HStack {
            if let current = viewer.current {
              actions(ImageViewerItem(store: host, agentKey: viewer.agentKey, imageId: current))
            }
            Spacer()
            IconBtn(systemName: Icon.close, label: "Close", tint: .white) { close() }
          }
          Spacer()
          if let position = viewer.positionLabel {
            Text(position)
              .font(.scaled(size: 12))
              .foregroundStyle(.white.opacity(0.7))
              .padding(.bottom, 12)
          }
        }
        .padding()
        .opacity(1 - dismissProgress)
      }
      .transition(.opacity)
    }
  }

  @ViewBuilder
  private func actions(_ item: ImageViewerItem) -> some View {
    if let image = item.image {
      #if canImport(UIKit)
        IconBtn(systemName: Icon.copy, label: "Copy Image", tint: .white) {
          UIPasteboard.general.image = image
          onAction(.copy)
        }
      #endif
      let shared = Image(platformImage: image)
      ShareLink(item: shared, preview: SharePreview(item.fileName, image: shared)) {
        Image(systemName: Icon.share)
          .font(.scaled(size: 17, weight: .medium))
          .foregroundStyle(.white)
          .frame(width: 32, height: 32)
          .contentShape(Rectangle())
      }
      .buttonStyle(.argusPlain)
      .accessibilityLabel("Share Image")
      .simultaneousGesture(TapGesture().onEnded { onAction(.share) })
    }
  }

  private func close() {
    zoomed = false
    dismissProgress = 0
    viewer.dismiss()
  }

  private let onAction: (Action) -> Void

  public init(onAction: @escaping (Action) -> Void = { _ in }) {
    self.onAction = onAction
  }
}

/// One page: loads its own bytes, and owns its own zoom so swiping away and
/// back doesn't inherit the previous page's transform.
private struct ZoomableImagePage: View {
  @Environment(HostStore.self) private var host

  let agentKey: String
  let imageId: String
  let isCurrent: Bool
  let onZoomChange: (Bool) -> Void
  let onDismissProgress: (CGFloat) -> Void
  let onDismiss: () -> Void

  @State private var scale: CGFloat = 1
  @State private var lastScale: CGFloat = 1
  @State private var offset = CGSize.zero
  @State private var lastOffset = CGSize.zero

  private static let maxScale: CGFloat = 4
  private static let doubleTapScale: CGFloat = 2.5
  private static let dismissDistance: CGFloat = 120
  private static let dismissVelocity: CGFloat = 800
  private static let zoomedThreshold: CGFloat = 1.01

  private var isZoomed: Bool { scale > Self.zoomedThreshold }

  private var image: PlatformImage? {
    host.cachedImage(agentId: agentKey, imageId: imageId).flatMap(PlatformImage.fromDataURI)
  }

  var body: some View {
    ZStack {
      if let image {
        Image(platformImage: image)
          .resizable()
          .scaledToFit()
          .scaleEffect(scale)
          .offset(offset)
          .gesture(magnification)
          .simultaneousGesture(drag)
          .onTapGesture(count: 2) { toggleZoom() }
          .onTapGesture { onDismiss() }
      } else {
        ProgressView().tint(.white)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .task(id: imageId) { await host.loadImage(agentId: agentKey, imageId: imageId) }
    .onChange(of: isCurrent) { _, current in
      // Reset a page the moment it stops being the one on screen, so it isn't
      // still zoomed when the user swipes back to it.
      if !current { reset() }
    }
    .onChange(of: isZoomed) { _, zoomed in
      guard isCurrent else { return }
      onZoomChange(zoomed)
    }
  }

  private var magnification: some Gesture {
    MagnifyGesture()
      .onChanged { value in
        scale = min(max(1, lastScale * value.magnification), Self.maxScale)
      }
      .onEnded { _ in
        lastScale = scale
        if scale <= 1 { resetPan() }
      }
  }

  private var drag: some Gesture {
    DragGesture()
      .onChanged { value in
        if isZoomed {
          offset = CGSize(
            width: lastOffset.width + value.translation.width,
            height: lastOffset.height + value.translation.height)
          return
        }
        // At rest, a downward drag means "put this away", not "pan".
        guard value.translation.height > 0 else { return }
        offset = CGSize(width: 0, height: value.translation.height)
        onDismissProgress(min(1, value.translation.height / Self.dismissDistance))
      }
      .onEnded { value in
        if isZoomed {
          lastOffset = offset
          return
        }
        if value.translation.height > Self.dismissDistance
          || value.velocity.height > Self.dismissVelocity
        {
          onDismiss()
        } else {
          withAnimation(.spring(duration: 0.25)) { offset = .zero }
          onDismissProgress(0)
        }
      }
  }

  private func toggleZoom() {
    withAnimation(.spring(duration: 0.25)) {
      if isZoomed {
        scale = 1
        lastScale = 1
        resetPan()
      } else {
        scale = Self.doubleTapScale
        lastScale = Self.doubleTapScale
      }
    }
  }

  private func reset() {
    scale = 1
    lastScale = 1
    resetPan()
  }

  private func resetPan() {
    offset = .zero
    lastOffset = .zero
  }
}
