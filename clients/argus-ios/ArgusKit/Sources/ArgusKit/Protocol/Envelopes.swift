import Foundation

/// The RPC envelopes, mirroring `packages/remote-protocol/src/messages.ts`.
///
/// `seq` is per connection, per direction, strictly increasing; both sides drop
/// anything at or below the last one seen.

/// Methods this client sends. A strict subset of the host's `REMOTE_METHODS` —
/// the phone has no browser-stream view and no device-claim arbitration.
public enum RemoteMethod: String, Codable, Sendable {
  case hostEndpoints = "host.endpoints"

  case projectsList = "projects.list"
  case sessionsList = "sessions.list"
  case sessionsCreate = "sessions.create"
  case sessionsDelete = "sessions.delete"
  case sessionsRename = "sessions.rename"
  case sessionsRenameBranch = "sessions.rename_branch"
  case sessionsFiles = "sessions.files"
  case sessionsResolveMentionPath = "sessions.resolve_mention_path"
  case sessionsGitStatus = "sessions.git_status"
  case sessionsBranches = "sessions.branches"
  case sessionsCheckout = "sessions.checkout"
  case sessionsCreateBranch = "sessions.create_branch"
  case sessionsDeleteBranch = "sessions.delete_branch"
  case sessionsDiff = "sessions.diff"
  case sessionsCommit = "sessions.commit"
  case sessionsPush = "sessions.push"
  case sessionsMergeBlockers = "sessions.merge_blockers"
  case sessionsMergeBase = "sessions.merge_base"

  case agentsList = "agents.list"
  case agentsStatus = "agents.status"
  case agentsTranscript = "agents.transcript"
  case agentsImage = "agents.image"
  case agentsStopped = "agents.stopped"
  case agentsStoppedTranscript = "agents.stopped_transcript"
  case agentsStoppedImage = "agents.stopped_image"
  case agentsCapabilities = "agents.capabilities"
  case agentsSend = "agents.send"
  case agentsInterrupt = "agents.interrupt"
  case agentsStop = "agents.stop"
  case agentsSetModel = "agents.set_model"
  case agentsSetPermissionMode = "agents.set_permission_mode"
  case agentsSetEffort = "agents.set_effort"
  case agentsSpawn = "agents.spawn"
  case agentsQueueList = "agents.queue_list"
  case agentsQueueAdd = "agents.queue_add"
  case agentsQueueRemove = "agents.queue_remove"
  case agentsQueueUpdate = "agents.queue_update"

  case githubPullRequests = "github.pull_requests"
  case githubPullRequest = "github.pull_request"
  case githubCreatePullRequest = "github.create_pull_request"
  case githubMergePullRequest = "github.merge_pull_request"
  case githubCommentPullRequest = "github.comment_pull_request"

  case permissionRespond = "permission.respond"

  case deviceRename = "device.rename"
  case deviceCapabilities = "device.capabilities"
  case devicePushInfo = "device.push_info"
  case deviceRegisterPush = "device.register_push"
  case deviceUnregisterPush = "device.unregister_push"

  case devicesList = "devices.list"
  case devicesClaim = "devices.claim"
  case devicesRelease = "devices.release"
  case devicesClaimStatus = "devices.claim_status"
  case devicesWatch = "devices.watch"
  case devicesUnwatch = "devices.unwatch"
  case devicesState = "devices.state"
  case devicesSetOrientation = "devices.set_orientation"
  case devicesSetFold = "devices.set_fold"
  case devicesTouch = "devices.touch"
  case devicesButton = "devices.button"
  case devicesKeyboard = "devices.keyboard"

  case automationsList = "automations.list"
  case automationsRuns = "automations.runs"
  case automationsRun = "automations.run"
  case automationsGet = "automations.get"
  case automationsSources = "automations.sources"
  case automationsRunners = "automations.runners"
  case automationsCreate = "automations.create"
  case automationsUpdate = "automations.update"
  case automationsRevisePlaybook = "automations.revise_playbook"
  case automationsDelete = "automations.delete"
  case automationsMemories = "automations.memories"
  case automationsSaveMemory = "automations.save_memory"
  case automationsDeleteMemory = "automations.delete_memory"
  case automationsSetEnabled = "automations.set_enabled"
  case automationsRunNow = "automations.run_now"
  case automationsRunScratch = "automations.run_scratch"
  case automationsSaveScratchRun = "automations.save_scratch_run"
  case automationsCancelRun = "automations.cancel_run"
  case automationsMarkRunRead = "automations.mark_run_read"
  case automationsRunFeedback = "automations.run_feedback"

  case proposalsList = "proposals.list"
  case proposalsAccept = "proposals.accept"
  case proposalsDismiss = "proposals.dismiss"
  case proposalsResolve = "proposals.resolve"
  case proposalsPerformCleanup = "proposals.perform_cleanup"

  case claudeAccountsList = "claude_accounts.list"
  case claudeAccountsSetActive = "claude_accounts.set_active"
  case claudeAccountsAdd = "claude_accounts.add"
  case claudeAccountsRemove = "claude_accounts.remove"
  case claudeAccountsRename = "claude_accounts.rename"
  case claudeAccountsLoginStart = "claude_accounts.login_start"
  case claudeAccountsLoginCancel = "claude_accounts.login_cancel"
  case claudeAccountsLoginSubmitCode = "claude_accounts.login_submit_code"
  case claudeAccountsLoginStatus = "claude_accounts.login_status"
}

/// Events the gateway pushes. Only those this client acts on are modelled;
/// anything else is ignored rather than treated as an error, so a newer desktop
/// never breaks an older phone.
public enum RemoteEventName: String, Sendable {
  case hostEndpoints = "host.endpoints"
  case agentStatus = "agent.status"
  case agentEvent = "agent.event"
  case agentQueue = "agent.queue"
  case agentCapabilities = "agent.capabilities"
  case permissionRequest = "permission.request"
  case permissionCancel = "permission.cancel"
  case deviceState = "device.state"
  case deviceClaim = "device.claim"
  case sessionsChanged = "sessions.changed"
  case projectsChanged = "projects.changed"
  case claudeAccountsChanged = "claude_accounts.changed"
  case claudeAccountsLogin = "claude_accounts.login"
  case notification = "notification"
}

public struct GatewayErrorPayload: Codable, Sendable, Error {
  public var code: String
  public var message: String
  public var data: JSONValue?

  /// The host refused on capability grounds, not because the call was wrong.
  public var isCapabilityDenied: Bool { code == "capability_denied" }
}

public struct RequestEnvelope<Params: Encodable>: Encodable {
  public var type = "req"
  public var seq: Int
  public var id: String
  public var method: RemoteMethod
  public var params: Params

  enum CodingKeys: String, CodingKey {
    case type, seq, id, method, params
  }
}

public struct SubscribeEnvelope: Encodable {
  public var type = "sub"
  public var seq: Int
  public var action: String
  public var agentId: String

  enum CodingKeys: String, CodingKey {
    case type, seq, action
    case agentId = "agent_id"
  }
}

public struct ResponseEnvelope: Decodable, Sendable {
  public var seq: Int
  public var id: String
  public var ok: JSONValue?
  public var error: GatewayErrorPayload?
}

public struct EventEnvelope: Decodable, Sendable {
  public var seq: Int
  public var event: String
  public var agentId: String?
  public var payload: JSONValue

  enum CodingKeys: String, CodingKey {
    case seq, event, payload
    case agentId = "agent_id"
  }
}

/// A frame from the gateway, after decryption and tag removal.
public enum ServerFrame: Sendable {
  case response(ResponseEnvelope)
  case event(EventEnvelope)
  /// A frame we don't model — ignored so a newer desktop never breaks us.
  case unknown
}

public enum ProtocolCodec {
  public static let encoder: JSONEncoder = {
    let e = JSONEncoder()
    e.outputFormatting = [.withoutEscapingSlashes]
    return e
  }()

  public static let decoder = JSONDecoder()

  public static func decodeFrame(_ data: Data) throws -> ServerFrame {
    struct Probe: Decodable { var type: String }
    let probe = try decoder.decode(Probe.self, from: data)
    switch probe.type {
    case "res": return .response(try decoder.decode(ResponseEnvelope.self, from: data))
    case "evt": return .event(try decoder.decode(EventEnvelope.self, from: data))
    default: return .unknown
    }
  }

  /// Re-decode a dynamic payload into a concrete type.
  ///
  /// The envelope carries `ok`/`payload` as free-form JSON because its shape
  /// depends on the method, so the concrete decode happens at the call site.
  public static func convert<T: Decodable>(_ value: JSONValue, to _: T.Type) throws -> T {
    if T.self == JSONValue.self, let v = value as? T { return v }
    return try decoder.decode(T.self, from: try encoder.encode(value))
  }
}

/// `{}` — the params for every method that takes none.
public struct EmptyParams: Encodable, Sendable {
  public init() {}
}

/// A result we accept but never read.
public struct IgnoredResult: Decodable, Sendable {
  public init(from _: Decoder) throws {}
}
