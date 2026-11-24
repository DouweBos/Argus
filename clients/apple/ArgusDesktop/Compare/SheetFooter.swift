import SwiftUI

/// Cancel and the primary action, which shows progress while it runs.
struct SheetFooter: View {
  let primaryTitle: String
  var isDestructive = false
  var isBusy = false
  var isDisabled = false
  let cancel: () -> Void
  let perform: () async -> Void

  var body: some View {
    HStack {
      if isBusy { ProgressView().controlSize(.small) }
      Spacer()
      Button("Cancel", action: cancel).keyboardShortcut(.cancelAction)
      Button(primaryTitle, role: isDestructive ? .destructive : nil) { Task { await perform() } }
        .keyboardShortcut(.defaultAction)
        .disabled(isDisabled || isBusy)
    }
  }
}
