import ArgusCore
import ArgusUI
import SwiftUI

/// Runner and model as form rows, nil meaning the app default — shared by the
/// automation and blueprint editors so both pick an agent the same way.
struct RunnerModelRows: View {
  @Binding var runner: String?
  @Binding var model: String?
  let runners: [RemoteRunner]
  /// After a runner switch, for fields that only apply to some runners.
  var runnerChanged: () -> Void = {}

  var body: some View {
    if !runners.isEmpty {
      Picker("Runner", selection: runnerBinding) {
        Text("Default").tag("")
        ForEach(runners) { runner in
          Text(runner.displayName).tag(runner.id)
            .disabled(!runner.isAvailable).help(runner.unavailableReason ?? "")
        }
      }
      RunnerSetupMenu(flows: runners.compactMap(RunnerSetupFlow.init), window: .main)
    }
    modelRow
  }

  /// A runner that declares its models gets a picker; Claude Code only learns
  /// its list from a live handshake, so there it stays free text.
  @ViewBuilder
  private var modelRow: some View {
    let declared = runner.flatMap { id in runners.first { $0.id == id } }?.models ?? []
    let binding = Binding(get: { model ?? "" }, set: { model = $0.isEmpty ? nil : $0 })
    if declared.isEmpty {
      TextField("Model", text: binding, prompt: Text("Blank uses the default"))
        .font(.system(.body, design: .monospaced))
    } else {
      Picker("Model", selection: binding) {
        Text("Default").tag("")
        ForEach(declared, id: \.value) { Text($0.displayName).tag($0.value) }
      }
    }
  }

  /// Model ids don't carry across runners, so a switch drops the model.
  private var runnerBinding: Binding<String> {
    Binding(
      get: { runner ?? "" },
      set: { id in
        runner = id.isEmpty ? nil : id
        model = nil
        runnerChanged()
      })
  }
}
