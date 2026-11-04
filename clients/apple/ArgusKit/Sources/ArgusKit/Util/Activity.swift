import Foundation

/// Activity and status derivation — a port of the desktop's
/// `activityDescription` + `spinnerVerbs`. Maps an agent's status and the tool
/// it is currently running to a short phrase ("Editing main.ts", "Running
/// command"), with a whimsical fallback while it is only thinking.
public enum Activity {
  public enum State: Sendable {
    case blocked, idle, stopped, working
  }

  public struct Description: Sendable {
    public var text: String
    public var state: State
  }

  static let toolVerbs: [String: String] = [
    "Agent": "Running agent",
    "Bash": "Running command",
    "Edit": "Editing file",
    "Glob": "Finding files",
    "Grep": "Searching code",
    "MultiEdit": "Editing files",
    "NotebookEdit": "Editing notebook",
    "Read": "Reading file",
    "WebFetch": "Fetching URL",
    "WebSearch": "Searching web",
    "Write": "Writing file",
  ]

  static func verb(_ toolName: String) -> String {
    toolVerbs[toolName] ?? "Using \(toolName)"
  }

  public static func toolActivity(_ toolName: String, input: [String: JSONValue]?) -> String {
    guard let input else { return verb(toolName) }
    switch toolName {
    case "Edit", "MultiEdit", "Write", "Read":
      let path = input["file_path"]?.stringValue ?? input["path"]?.stringValue
      guard let path else { return verb(toolName) }
      let basename = path.split(separator: "/").last.map(String.init) ?? path
      return toolName == "Read" ? "Reading \(basename)" : "Editing \(basename)"
    case "WebFetch":
      guard let raw = input["url"]?.stringValue,
        let host = URL(string: raw)?.host()
      else { return verb(toolName) }
      return "Fetching \(host)"
    case "Glob":
      guard let pattern = input["pattern"]?.stringValue else { return verb(toolName) }
      return "Finding \(pattern)"
    case "Grep":
      guard let pattern = input["pattern"]?.stringValue else { return verb(toolName) }
      let clipped = pattern.count > 20 ? String(pattern.prefix(20)) + "…" : pattern
      return "Searching for \"\(clipped)\""
    case "Bash":
      return "Running command"
    default:
      return verb(toolName)
    }
  }

  public static func derive(
    status: RemoteAgentState?,
    pendingToolName: String?,
    pendingToolInput: [String: JSONValue]? = nil,
    hasPendingPermission: Bool
  ) -> Description {
    switch status {
    case .stopped, .error:
      return Description(text: "Stopped", state: .stopped)
    case .idle, .none:
      return Description(text: "Idle", state: .idle)
    default:
      break
    }
    if hasPendingPermission {
      return Description(text: "Waiting for permission", state: .blocked)
    }
    if let pendingToolName {
      return Description(
        text: toolActivity(pendingToolName, input: pendingToolInput), state: .working)
    }
    return Description(text: "Thinking", state: .working)
  }

  /// Shown instead of a bare "Thinking". Held stable for a whole thinking
  /// episode by the caller so it doesn't flicker on every re-render.
  public static let spinnerVerbs = [
    "Cogitating", "Ruminating", "Pondering", "Deliberating", "Musing",
    "Percolating", "Marinating", "Noodling", "Puzzling", "Contemplating",
    "Mulling", "Chewing", "Brewing", "Churning", "Whirring",
    "Scheming", "Plotting", "Divining", "Conjuring", "Untangling",
    "Unravelling", "Excavating", "Spelunking", "Foraging", "Rummaging",
    "Wrangling", "Herding", "Juggling", "Orchestrating", "Assembling",
    "Distilling", "Fermenting", "Simmering", "Reducing", "Steeping",
    "Calibrating", "Triangulating", "Extrapolating", "Interpolating", "Inferring",
    "Consulting", "Deducing", "Surmising", "Reckoning", "Weighing",
    "Sifting", "Winnowing", "Threading", "Splicing", "Knitting",
    "Tessellating", "Crystallising", "Coalescing", "Converging", "Homing in",
    "Circling", "Closing in",
  ]

  public static func randomSpinnerVerb() -> String {
    #if DEBUG
      // Marketing captures (`pnpm shots`) must read the same run to run.
      if let fixed = ProcessInfo.processInfo.environment["ARGUS_SPINNER_VERB"] { return fixed }
    #endif
    return spinnerVerbs.randomElement() ?? "Thinking"
  }
}
