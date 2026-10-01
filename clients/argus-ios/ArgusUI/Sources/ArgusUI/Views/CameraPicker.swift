#if os(iOS)
  import SwiftUI
  import UIKit

  /// A plain camera capture — the photo library picker covers everything else.
  struct CameraPicker: UIViewControllerRepresentable {
    public let onCapture: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    public func makeCoordinator() -> Coordinator {
      Coordinator(onCapture: onCapture, dismiss: { dismiss() })
    }

    public func makeUIViewController(context: Context) -> UIImagePickerController {
      let controller = UIImagePickerController()
      controller.sourceType =
        UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
      controller.delegate = context.coordinator
      return controller
    }

    public func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    public final class Coordinator: NSObject, UIImagePickerControllerDelegate,
      UINavigationControllerDelegate
    {
      private let onCapture: (UIImage) -> Void
      private let dismiss: () -> Void

      init(onCapture: @escaping (UIImage) -> Void, dismiss: @escaping () -> Void) {
        self.onCapture = onCapture
        self.dismiss = dismiss
      }

      func imagePickerController(
        _ picker: UIImagePickerController,
        didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
      ) {
        if let image = info[.originalImage] as? UIImage { onCapture(image) }
        dismiss()
      }

      func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        dismiss()
      }
    }
  }
#endif
