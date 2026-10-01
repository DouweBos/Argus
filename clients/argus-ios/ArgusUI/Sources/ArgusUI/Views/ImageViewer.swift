import ArgusKit
import SwiftUI
import UIKit

/// One full-screen image presenter for the whole app, so any transcript image
/// can open without threading modal state through every view between.
///
/// Holds image *ids* rather than decoded images: a message can carry several
/// and only the tapped one is guaranteed to be loaded, so the pager resolves
/// its neighbours from the store as you reach them.
@MainActor
@Observable
final class ImageViewerState {
  private(set) var agentKey = ""
  private(set) var imageIds: [String] = []
  var current: String?

  var isPresented: Bool { current != nil }

  func present(agentKey: String, imageIds: [String], at index: Int) {
    guard imageIds.indices.contains(index) else { return }
    // A keyboard left standing behind a full-screen image is both pointless
    // and in the way of the dismiss gesture.
    UIApplication.shared.sendAction(
      #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    self.agentKey = agentKey
    self.imageIds = imageIds
    self.current = imageIds[index]
  }

  func dismiss() {
    current = nil
    imageIds = []
  }

  var currentIndex: Int? {
    current.flatMap { imageIds.firstIndex(of: $0) }
  }
}

/// Pinch, double-tap, pan, swipe down to dismiss, and swipe across to page.
struct ImageViewerOverlay: View {
  @Environment(ImageViewerState.self) private var viewer
  @State private var zoomed = false
  @State private var dismissProgress: CGFloat = 0

  var body: some View {
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
            Spacer()
            IconBtn(systemName: Icon.close, label: "Close", tint: .white) { close() }
          }
          Spacer()
          if viewer.imageIds.count > 1, let index = viewer.currentIndex {
            Text("\(index + 1) of \(viewer.imageIds.count)")
              .font(.system(size: 12))
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

  private func close() {
    zoomed = false
    dismissProgress = 0
    viewer.dismiss()
  }
}

/// One page: loads its own bytes, and owns its own zoom so swiping away and
/// back doesn't inherit the previous page's transform.
private struct ZoomableImagePage: View {
  @Environment(AppStore.self) private var app

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

  private var image: UIImage? {
    app.cachedImage(agentId: agentKey, imageId: imageId).flatMap(UIImage.fromDataURI)
  }

  var body: some View {
    ZStack {
      if let image {
        Image(uiImage: image)
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
    .task(id: imageId) { await app.loadImage(agentId: agentKey, imageId: imageId) }
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
