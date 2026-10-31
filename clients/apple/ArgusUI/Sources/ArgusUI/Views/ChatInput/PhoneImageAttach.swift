#if os(iOS)
  import PhotosUI
  import SwiftUI

  /// The images waiting to go out, each with a remove badge.
  struct PendingImageStrip: View {
    @Environment(\.theme) private var theme
    let images: [PendingImage]
    let onRemove: (UUID) -> Void

    var body: some View {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          ForEach(images) { pending in
            Image(platformImage: pending.preview)
              .resizable()
              .scaledToFill()
              .frame(width: 56, height: 56)
              .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
              .overlay(alignment: .topTrailing) {
                Button {
                  onRemove(pending.id)
                } label: {
                  Image(systemName: Icon.close)
                    .font(.scaled(size: 9, weight: .bold))
                    .foregroundStyle(theme.onAccent)
                    .padding(4)
                    .background(Circle().fill(theme.accent))
                }
                .buttonStyle(.argusPlain)
                .offset(x: 6, y: -6)
              }
          }
        }
        .padding(.top, 6)
      }
    }
  }

  extension View {
    /// The attach menu — photo library or camera — and the pickers it opens.
    func phoneImageAttach(isPresented: Binding<Bool>, onAttach: @escaping ([PendingImage]) -> Void) -> some View {
      modifier(PhoneImageAttach(showingMenu: isPresented, onAttach: onAttach))
    }
  }

  private struct PhoneImageAttach: ViewModifier {
    @Binding var showingMenu: Bool
    let onAttach: ([PendingImage]) -> Void
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showingCamera = false
    @State private var showingPhotoLibrary = false

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
          Button("Cancel", role: .cancel) {}
        }
        .fullScreenCover(isPresented: $showingCamera) {
          CameraPicker { photo in onAttach(ImageAttachments.pending(photo: photo).map { [$0] } ?? []) }
        }
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
