import AppKit
import ArgusUI
import SwiftUI

/// The Mac's image viewer: a card over a dimmed window, sized to the image
/// within four fifths of the window, as the desktop shows one. Esc or a click
/// outside closes it; ← and → page through the message's other images.
struct ImageViewerPanel: View {
  @Environment(ImageViewerState.self) private var viewer
  @Environment(HostStore.self) private var host
  @Environment(\.theme) private var theme
  @FocusState private var focused: Bool

  var body: some View {
    if viewer.isPresented, let current = viewer.current {
      GeometryReader { geometry in
        ZStack {
          theme.mediaBg.opacity(0.45)
            .contentShape(Rectangle())
            .onTapGesture { close() }
            .accessibilityLabel("Close image")
          card(current, room: CGSize(width: geometry.size.width * 0.8, height: geometry.size.height * 0.8))
        }
        .frame(width: geometry.size.width, height: geometry.size.height)
      }
      .focusable()
      .focusEffectDisabled()
      .focused($focused)
      .onAppear { focused = true }
      .onKeyPress(.escape) {
        close()
        return .handled
      }
      .onKeyPress(.leftArrow) { page(by: -1) }
      .onKeyPress(.rightArrow) { page(by: 1) }
      .task(id: current) { await host.loadImage(agentId: viewer.agentKey, imageId: current) }
      .transition(.opacity)
    }
  }

  private func card(_ imageId: String, room: CGSize) -> some View {
    let image = ViewedImage(store: host, agentKey: viewer.agentKey, imageId: imageId)
    let header: CGFloat = 40
    let fitted = image.fitted(in: CGSize(width: room.width - 32, height: room.height - header - 32))
    return VStack(spacing: 0) {
      HStack(spacing: 4) {
        Text(title)
          .font(.scaled(size: 12, weight: .medium))
          .foregroundStyle(theme.textSecondary)
        Spacer()
        IconBtn(systemName: Icon.copy, label: "Copy Image", size: 12) { act(.copy, image) }
          .disabled(image.data == nil)
        IconBtn(systemName: Icon.download, label: "Save Image…", size: 12) { act(.save, image) }
          .disabled(image.data == nil)
        IconBtn(systemName: Icon.eye, label: "Open in Preview", size: 12) { act(.openPreview, image) }
          .disabled(image.data == nil)
        IconBtn(systemName: Icon.close, label: "Close (Esc)", size: 12) { close() }
      }
      .padding(.horizontal, 12)
      .frame(height: header)
      ZStack {
        if let platform = image.image {
          Image(platformImage: platform)
            .resizable()
            .interpolation(.high)
            .frame(width: fitted.width, height: fitted.height)
        } else {
          ProgressView().controlSize(.small).frame(width: 240, height: 160)
        }
        if viewer.imageIds.count > 1 {
          HStack {
            IconBtn(systemName: Icon.chevronLeft, label: "Previous image (←)", size: 13) { _ = page(by: -1) }
            Spacer()
            IconBtn(systemName: Icon.chevronRight, label: "Next image (→)", size: 13) { _ = page(by: 1) }
          }
          .padding(.horizontal, 8)
        }
      }
      .padding(16)
    }
    // Wide enough for its toolbar, else as wide as the image.
    .frame(width: max(fitted.width + 32, 320))
    .background(theme.bgSecondary, in: RoundedRectangle(cornerRadius: theme.radius))
    .overlay(RoundedRectangle(cornerRadius: theme.radius).stroke(theme.border, lineWidth: 1))
    .shadow(color: theme.mediaBg.opacity(0.3), radius: 24, y: 8)
    .contextMenu {
      Button("Copy Image") { act(.copy, image) }
      Button("Save Image…") { act(.save, image) }
      Button("Open in Preview") { act(.openPreview, image) }
    }
  }

  private var title: String {
    guard viewer.imageIds.count > 1, let index = viewer.currentIndex else { return "Image" }
    return "Image \(index + 1) of \(viewer.imageIds.count)"
  }

  private func page(by step: Int) -> KeyPress.Result {
    guard let index = viewer.currentIndex, viewer.imageIds.count > 1 else { return .ignored }
    let next = (index + step + viewer.imageIds.count) % viewer.imageIds.count
    viewer.current = viewer.imageIds[next]
    MacTelemetry.capture(.imageViewerUsed(action: .page))
    return .handled
  }

  private func act(_ action: MacTelemetryEvent.ImageViewerAction, _ image: ViewedImage) {
    guard let data = image.data else { return NSSound.beep() }
    switch action {
    case .copy:
      guard let platform = image.image else { return }
      let board = TranscriptSystem.pasteboard
      board.clearContents()
      board.writeObjects([platform])
    case .save:
      ImageFiles.save(data, name: image.fileName)
    case .openPreview:
      guard let url = ImageFiles.temporary(data, name: image.fileName) else { return NSSound.beep() }
      TranscriptSystem.open(url, with: URL(fileURLWithPath: "/System/Applications/Preview.app"))
    case .open, .page:
      break
    }
    MacTelemetry.capture(.imageViewerUsed(action: action))
  }

  private func close() {
    viewer.dismiss()
  }
}

/// A transcript image's bytes from the store's cache.
@MainActor
private struct ViewedImage {
  let data: Data?
  let mediaType: String
  let image: NSImage?
  let imageId: String

  init(store: HostStore, agentKey: String, imageId: String) {
    self.imageId = imageId
    let uri = store.cachedImage(agentId: agentKey, imageId: imageId)
    let parsed = uri.flatMap(Self.parse)
    data = parsed?.data
    mediaType = parsed?.mediaType ?? "image/png"
    image = data.flatMap(NSImage.init(data:))
  }

  var fileName: String {
    let ext = mediaType.split(separator: "/").last.map { $0 == "jpeg" ? "jpg" : String($0) } ?? "png"
    let stem = imageId.replacingOccurrences(of: ":", with: "-").replacingOccurrences(of: "/", with: "-")
    return "argus-\(stem).\(ext)"
  }

  /// Within `room`, never past the image's own size.
  func fitted(in room: CGSize) -> CGSize {
    guard let size = image?.size, size.width > 0, size.height > 0 else { return CGSize(width: 240, height: 160) }
    let scale = min(1, room.width / size.width, room.height / size.height)
    return CGSize(width: max(1, (size.width * scale).rounded()), height: max(1, (size.height * scale).rounded()))
  }

  private static func parse(_ uri: String) -> (data: Data, mediaType: String)? {
    guard uri.hasPrefix("data:"), let comma = uri.firstIndex(of: ","),
      let data = Data(base64Encoded: String(uri[uri.index(after: comma)...]))
    else { return nil }
    let header = uri[uri.index(uri.startIndex, offsetBy: 5)..<comma]
    return (data, header.split(separator: ";").first.map(String.init) ?? "image/png")
  }
}

/// Where a viewed image goes on disk.
@MainActor
enum ImageFiles {
  /// A copy for another app to open, in a temporary folder the system cleans.
  static func temporary(_ data: Data, name: String) -> URL? {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Argus Images", isDirectory: true)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let url = folder.appendingPathComponent(name)
    return (try? data.write(to: url)) != nil ? url : nil
  }

  static func save(_ data: Data, name: String) {
    if TranscriptSystem.stubbed("save \(name) \(data.count) bytes") { return }
    let panel = NSSavePanel()
    panel.nameFieldStringValue = name
    panel.canCreateDirectories = true
    let write: (NSApplication.ModalResponse) -> Void = { response in
      guard response == .OK, let url = panel.url else { return }
      try? data.write(to: url)
    }
    if let window = NSApp.keyWindow { panel.beginSheetModal(for: window, completionHandler: write) } else {
      panel.begin(completionHandler: write)
    }
  }
}
