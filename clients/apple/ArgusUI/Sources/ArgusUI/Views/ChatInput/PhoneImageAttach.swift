#if os(iOS)
  import ArgusCore
  import PhotosUI
  import SwiftUI

  /// The images and files waiting to go out, each with a remove badge.
  public struct PhoneAttachmentStrip: View {
    @Environment(\.theme) private var theme
    let images: [PendingImage]
    let files: [PendingFile]
    let onRemoveImage: (UUID) -> Void
    let onRemoveFile: (UUID) -> Void

    public init(
      images: [PendingImage], files: [PendingFile], onRemoveImage: @escaping (UUID) -> Void,
      onRemoveFile: @escaping (UUID) -> Void
    ) {
      self.images = images
      self.files = files
      self.onRemoveImage = onRemoveImage
      self.onRemoveFile = onRemoveFile
    }

    public var body: some View {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          ForEach(images) { pending in
            Image(platformImage: pending.preview)
              .resizable()
              .scaledToFill()
              .frame(width: 56, height: 56)
              .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
              .overlay(alignment: .topTrailing) { removeBadge(label: "Remove image") { onRemoveImage(pending.id) } }
          }
          ForEach(files) { file in
            PendingFileChip(file: file)
              .overlay(alignment: .topTrailing) { removeBadge(label: "Remove \(file.name)") { onRemoveFile(file.id) } }
          }
        }
        .padding(.top, 6)
        .padding(.trailing, 6)
      }
    }

    private func removeBadge(label: String, action: @escaping () -> Void) -> some View {
      Button(action: action) {
        Image(systemName: Icon.close)
          .font(.scaled(size: 9, weight: .bold))
          .foregroundStyle(theme.onAccent)
          .padding(4)
          .background(Circle().fill(theme.accent))
      }
      .buttonStyle(.argusPlain)
      .accessibilityLabel(label)
      .offset(x: 6, y: -6)
    }
  }

  extension View {
    /// The attach menu — photo library, camera or Files — and the pickers it opens.
    func phoneAttach(
      isPresented: Binding<Bool>, onAttach: @escaping ([PendingImage]) -> Void,
      onAttachFiles: @escaping ([(name: String, size: Int, source: AttachmentSource)]) -> Void
    ) -> some View {
      modifier(PhoneImageAttach(showingMenu: isPresented, onAttach: onAttach, onAttachFiles: onAttachFiles))
    }
  }

  private struct PhoneImageAttach: ViewModifier {
    @Binding var showingMenu: Bool
    let onAttach: ([PendingImage]) -> Void
    let onAttachFiles: ([(name: String, size: Int, source: AttachmentSource)]) -> Void
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showingCamera = false
    @State private var showingPhotoLibrary = false
    @State private var showingFiles = false

    func body(content: Content) -> some View {
      content
        // Compatible: HEIC arrives as JPEG, which the API reads and stays under the gateway's frame limit.
        .photosPicker(
          isPresented: $showingPhotoLibrary, selection: $photoItems, matching: .images,
          preferredItemEncoding: .compatible)
        .onChange(of: photoItems) { _, items in Task { await attach(items) } }
        .confirmationDialog("Attach", isPresented: $showingMenu, titleVisibility: .hidden) {
          Button("Photo Library") { showingPhotoLibrary = true }
          Button("Take Photo") { showingCamera = true }
          Button("Choose File") { showingFiles = true }
          Button("Cancel", role: .cancel) {}
        }
        .fileImporter(isPresented: $showingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) {
          result in
          if case .success(let urls) = result { importFiles(urls) }
        }
        .fullScreenCover(isPresented: $showingCamera) {
          CameraPicker { photo in onAttach(ImageAttachments.pending(photo: photo).map { [$0] } ?? []) }
        }
    }

    /// Read while the picker's security scope is open: images join the image path, the rest upload as files.
    private func importFiles(_ urls: [URL]) {
      var images: [PendingImage] = []
      var files: [(name: String, size: Int, source: AttachmentSource)] = []
      for url in urls {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        if ImageAttachments.isImage(url), let image = ImageAttachments.pending(fromFile: url) {
          images.append(image)
          continue
        }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        // Past the cap it's refused by size alone, so the bytes are never loaded.
        guard size <= HostStore.maxAttachmentBytes else {
          files.append((url.lastPathComponent, size, .file(url)))
          continue
        }
        guard let data = try? Data(contentsOf: url) else { continue }
        files.append((url.lastPathComponent, data.count, .bytes(data)))
      }
      if !images.isEmpty { onAttach(images) }
      if !files.isEmpty { onAttachFiles(files) }
    }

    private func attach(_ items: [PhotosPickerItem]) async {
      guard !items.isEmpty else { return }
      for item in items {
        guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
        onAttach(ImageAttachments.pending(data: data).map { [$0] } ?? [])
      }
      photoItems = []
    }
  }
#endif
