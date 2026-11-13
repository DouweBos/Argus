import ArgusCore
import SwiftUI

/// "Model prices": hand-set prices and mappings, edited in place and saved
/// together. `onClose` leaves the screen after Save or Cancel.
public struct HostUsagePricesView: View {
  @Environment(HostStore.self) private var host
  @Environment(\.theme) private var theme
  let canEdit: Bool
  let onClose: () -> Void
  @State private var draft: UsagePriceDraft?
  @State private var saving = false
  @State private var error: String?

  public init(canEdit: Bool = true, onClose: @escaping () -> Void) {
    self.canEdit = canEdit
    self.onClose = onClose
  }

  public var body: some View {
    Group {
      if let draft = Binding($draft) {
        UsagePriceEditor(draft: draft, canEdit: canEdit, error: error)
          .safeAreaInset(edge: .bottom, spacing: 0) { footer(dirty: draft.wrappedValue.isDirty) }
      } else if let failure = host.usagePricesError {
        EmptyState(icon: Icon.warning, title: "Couldn't load model prices", body: failure, selectable: true) {
          Btn(label: "Retry", tone: .secondary, small: true, icon: Icon.refresh) { Task { await load() } }.fixedSize()
        }
      } else {
        Loading(label: "Loading model prices…").frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .background(theme.bg.ignoresSafeArea())
    .task(id: host.connection == .ready) {
      guard host.connection == .ready, draft == nil else { return }
      await load()
    }
  }

  private func load() async {
    await host.loadUsagePrices()
    guard let prices = host.usagePrices else { return }
    draft = UsagePriceDraft(prices: prices, adding: canEdit ? host.pendingPriceModel : nil)
    host.pendingPriceModel = nil
  }

  private func footer(dirty: Bool) -> some View {
    HStack(spacing: theme.space) {
      if !canEdit {
        Text("Viewing only: this device can't change prices.")
          .font(.scaled(size: 12))
          .foregroundStyle(theme.textMuted)
      }
      Spacer(minLength: 0)
      Btn(label: "Cancel", tone: .secondary, small: true, hugs: true, action: onClose)
      if canEdit {
        Btn(label: "Save changes", small: true, hugs: true, busy: saving) { Task { await save() } }
          .disabled(!dirty || saving)
      }
    }
    .padding(theme.space)
    .background(theme.bgSecondary)
    .overlay(alignment: .top) { Divider().overlay(theme.borderSubtle) }
  }

  private func save() async {
    guard let draft else { return }
    switch draft.overrides() {
    case .failure(let failure):
      error = failure.message
    case .success(let overrides):
      saving = true
      defer { saving = false }
      if let failure = await host.saveUsagePrices(overrides) {
        error = failure
      } else {
        error = nil
        onClose()
      }
    }
  }
}

/// The editor's rows: an add field, then a card per model.
struct UsagePriceEditor: View {
  @Environment(\.theme) private var theme
  @Binding var draft: UsagePriceDraft
  let canEdit: Bool
  let error: String?
  @State private var newModel = ""

  var body: some View {
    Screen {
      Text("US dollars per million tokens. A blank cache rate uses the input rate and 0 makes it free. Map a model to count it as another one.")
        .font(.scaled(size: 13))
        .foregroundStyle(theme.textMuted)
        .fixedSize(horizontal: false, vertical: true)
      if let error {
        Banner(text: error, tone: .danger)
      }
      if canEdit {
        HStack(spacing: 8) {
          UsagePriceField(placeholder: "Add a model by id", text: $newModel, mono: true, onSubmit: add)
          Btn(label: "Add model", tone: .secondary, small: true, icon: Icon.plus, hugs: true, action: add)
            .disabled(newModel.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      }
      if draft.rows.isEmpty {
        EmptyState(
          icon: Icon.price, title: "No models yet",
          body: "Models used in the last 90 days show up here with their list price.")
      } else {
        #if os(macOS)
          Card {
            VStack(alignment: .leading, spacing: 8) {
              UsagePriceRowEditor.header
              ForEach(draft.rows) { row in
                Divider().overlay(theme.borderSubtle)
                rowEditor(row)
              }
            }
          }
        #else
          ForEach(draft.rows) { row in Card { rowEditor(row) } }
        #endif
      }
    }
  }

  private func rowEditor(_ row: UsagePriceDraft.Row) -> some View {
    UsagePriceRowEditor(
      row: Binding(get: { draft[row.model] ?? row }, set: { draft[row.model] = $0 }), canEdit: canEdit
    ) {
      draft.toggleReset(row.model)
    }
  }

  private func add() {
    if draft.add(newModel) { newModel = "" }
  }
}
