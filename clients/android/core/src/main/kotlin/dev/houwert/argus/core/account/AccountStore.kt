package dev.houwert.argus.core.account

import dev.houwert.argus.kit.account.AccountClient
import dev.houwert.argus.kit.account.AccountAuthenticating
import dev.houwert.argus.kit.account.AccountCodec
import dev.houwert.argus.kit.account.AccountDeviceKeys
import dev.houwert.argus.kit.account.AccountEntryBuilder
import dev.houwert.argus.kit.account.AccountHttp
import dev.houwert.argus.kit.account.AccountInfo
import dev.houwert.argus.kit.account.AccountJoinRequestInfo
import dev.houwert.argus.kit.account.AccountLog
import dev.houwert.argus.kit.account.AccountLogRejectReason
import dev.houwert.argus.kit.account.AccountLogState
import dev.houwert.argus.kit.account.AccountMember
import dev.houwert.argus.kit.account.AccountProfile
import dev.houwert.argus.kit.account.AccountServiceError
import dev.houwert.argus.kit.account.AccountSignInProvider
import dev.houwert.argus.kit.account.AccountVault
import dev.houwert.argus.kit.account.AccountVaultStore
import dev.houwert.argus.kit.account.AccountVerifyResult
import dev.houwert.argus.kit.storage.DeviceIdentity
import dev.houwert.argus.kit.storage.RemoteEndpoint
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * The signed-in Argus account on this device: sign-in, its verified log, the hosts on it with their
 * verified presence, and linking new ones. The service is untrusted: everything shown comes from the
 * log this store verified itself, against the root it pinned at genesis or resume.
 *
 * Threading: like `HostStore`, every mutation runs on [scope]'s single-threaded dispatcher.
 */
class AccountStore(
  internal val scope: CoroutineScope,
  internal val auth: AccountAuthenticating,
  internal val vaultStore: AccountVaultStore,
  /** The wire device kind this install joins as. */
  internal val deviceKind: String,
  /** The name setting's current value; joins and links use it. */
  internal val deviceName: () -> String,
  /** The Mac app's bundled host; always null on a phone, kept so the store's logic stays the same. */
  internal val localHost: AccountLocalHostLinking? = null,
  baseUrl: String = AccountClient.DEFAULT_BASE_URL,
  http: AccountHttp? = null,
  internal val now: () -> Long = System::currentTimeMillis,
  internal val joinPollIntervalMs: Long = 3_000,
) {
  enum class Phase {
    Loading,
    SignedOut,
    SigningIn,
    /** Signed in with Clerk; creating or reading the account log. */
    SettingUp,
    Ready,
    /** The account already has devices and this one isn't on it yet: it asks to join and waits. */
    AwaitingApproval,
  }

  /** A host on the account, from the verified log plus verified presence. */
  data class Host(
    val member: AccountMember,
    val endpoints: List<RemoteEndpoint>,
    /** Milliseconds since the epoch the service last heard from it. */
    val lastSeen: Double?,
    val online: Boolean,
    /** The Mac app's own bundled host. */
    val isLocal: Boolean,
  ) {
    val id: String get() = member.id
    val name: String get() = member.name
  }

  sealed interface Event {
    data class SignedIn(val provider: AccountSignInProvider, val firstDevice: Boolean) : Event
    data object SignedOut : Event
    /** Signing with this device's key didn't simply work. */
    data class MemberAuth(val outcome: MemberAuthOutcome) : Event
    data class MemberRemoved(val role: AccountMember.Role) : Event
    data class MemberRenamed(val role: AccountMember.Role) : Event
    /** [viaPairing]: started from a QR-paired computer rather than a typed code. */
    data class ComputerAdded(val viaPairing: Boolean) : Event
    data class JoinActed(val action: JoinAction, val role: JoinRole) : Event
    data class PushRegistered(val success: Boolean) : Event
    /** This device's name setting changed here; [linked]: put on the account too. */
    data class NameChanged(val source: NameSource, val linked: Boolean) : Event
    data class AccountReset(val action: ResetAction) : Event
    data class LocalHost(val outcome: LocalHostOutcome) : Event
  }

  enum class NameSource(val raw: String) { Settings("settings"), AccountList("account_list") }
  enum class JoinAction(val raw: String) { Requested("requested"), Approved("approved"), Denied("denied"), Expired("expired") }
  /** Whether this device was the one joining or the one approving. */
  enum class JoinRole(val raw: String) { Subject("subject"), Approver("approver") }

  internal val _phase = MutableStateFlow(Phase.Loading)
  val phase: StateFlow<Phase> = _phase.asStateFlow()
  internal val _state = MutableStateFlow<AccountLogState?>(null)
  val state: StateFlow<AccountLogState?> = _state.asStateFlow()
  internal val _hosts = MutableStateFlow(emptyList<Host>())
  val hosts: StateFlow<List<Host>> = _hosts.asStateFlow()
  internal val _link = MutableStateFlow<LinkFlow>(LinkFlow.Idle)
  val link: StateFlow<LinkFlow> = _link.asStateFlow()
  /** The last thing that went wrong, for the screen to show. */
  internal val _error = MutableStateFlow<String?>(null)
  val error: StateFlow<String?> = _error.asStateFlow()
  /** Set when the service served a log that doesn't verify; the last good one stays. */
  internal val _logError = MutableStateFlow<AccountLogRejectReason?>(null)
  val logError: StateFlow<AccountLogRejectReason?> = _logError.asStateFlow()
  internal val _localLinkError = MutableStateFlow<String?>(null)
  val localLinkError: StateFlow<String?> = _localLinkError.asStateFlow()
  internal val _localLinkConflict = MutableStateFlow(false)
  val localLinkConflict: StateFlow<Boolean> = _localLinkConflict.asStateFlow()
  /** An email code is on its way and the next step is to type it. */
  internal val _awaitingEmailCode = MutableStateFlow(false)
  val awaitingEmailCode: StateFlow<Boolean> = _awaitingEmailCode.asStateFlow()
  /** The way in that's running while [phase] is SigningIn, for its button's spinner. */
  internal val _signingInWith = MutableStateFlow<AccountSignInProvider?>(null)
  val signingInWith: StateFlow<AccountSignInProvider?> = _signingInWith.asStateFlow()
  /** Who is signed in, for the account header. Never sent anywhere. */
  internal val _profile = MutableStateFlow<AccountProfile?>(null)
  val profile: StateFlow<AccountProfile?> = _profile.asStateFlow()
  internal val _join = MutableStateFlow<JoinFlow>(JoinFlow.Idle)
  val join: StateFlow<JoinFlow> = _join.asStateFlow()
  /** Computers and devices waiting for an approval, proofs checked. */
  internal val _requests = MutableStateFlow(emptyList<AccountJoinRequestInfo>())
  val requests: StateFlow<List<AccountJoinRequestInfo>> = _requests.asStateFlow()
  internal val _approval = MutableStateFlow<ApprovalFlow>(ApprovalFlow.Idle)
  val approval: StateFlow<ApprovalFlow> = _approval.asStateFlow()
  internal val _reset = MutableStateFlow<ResetFlow>(ResetFlow.Idle)
  val reset: StateFlow<ResetFlow> = _reset.asStateFlow()
  /** The account was reset from another device; shown until this one is back on it. */
  internal val _resetNotice = MutableStateFlow<AccountResetNotice?>(null)
  val resetNotice: StateFlow<AccountResetNotice?> = _resetNotice.asStateFlow()
  /** Another device removed this one; cleared by signing back in or dismissing. */
  internal val _removed = MutableStateFlow(false)
  val removed: StateFlow<Boolean> = _removed.asStateFlow()
  /** An identity action needs the sign-in this device no longer holds: show it. */
  internal val _signInNeeded = MutableStateFlow<IdentityAction?>(null)
  val signInNeeded: StateFlow<IdentityAction?> = _signInNeeded.asStateFlow()

  /** The account hosts changed; rebuild the host list. */
  var onHostsChanged: (List<DeviceIdentity>) -> Unit = {}
  var onEvent: (Event) -> Unit = {}
  /** This device appended entries: hand them to the connected hosts (`account.sync`). */
  var onLogAppended: () -> Unit = {}
  /** The name setting should now read this. The app persists it; [deviceName] then returns it. */
  var onNameChanged: (String) -> Unit = {}

  internal val client: AccountClient
  internal var vault = AccountVault.EMPTY
  internal var configured = false
  internal var pendingLink: PendingLink? = null
  internal var pendingJoin: PendingJoin? = null
  internal var approvedJoin: ApprovedJoin? = null
  internal var approvalsCache: Pair<dev.houwert.argus.kit.account.AccountHead, Map<String, dev.houwert.argus.kit.account.AccountApproval>>? = null
  internal var pendingApproval: PendingLink? = null
  internal var joinLoop: Job? = null
  private var retryLoop: Job? = null
  /** The push token to keep registered with the account, and what was last sent. */
  internal var pushToken: AccountPushToken? = null
  internal var pushFingerprint: String? = null
  internal val reportedMemberAuth = mutableSetOf<MemberAuthOutcome>()

  init {
    client = AccountClient(
      baseUrl = baseUrl,
      token = { auth.token() },
      signer = { memberSigner },
      http = http,
      now = now,
      onClerkFallback = { scope.launch { reportMemberAuth(MemberAuthOutcome.ClerkFallback) } },
    )
  }

  /** This device's key, once it is a live member of the account it pinned. */
  internal val memberSigner
    get() = _state.value?.takeIf { _phase.value == Phase.Ready && ownMemberLive(it) }?.let { vault.keys?.signer }

  val isSignedIn: Boolean get() = _phase.value == Phase.Ready
  val memberId: String? get() = vault.keys?.memberId
  val safetyCode: String? get() = _state.value?.root?.safetyCode

  /** Devices and hosts on the account, oldest first. */
  val members: List<AccountMember> get() = _state.value?.liveMembers ?: emptyList()

  fun host(hostId: String): Host? = _hosts.value.firstOrNull { it.id == hostId }

  /** Run an action on the store's own scope, so a screen leaving (a browser sign-in returning) can't cancel it halfway. */
  fun perform(action: suspend AccountStore.() -> Unit): Job = scope.launch { action() }

  // Lifecycle

  /**
   * Read back what this device already trusts, then reach the service. Cached hosts show straight away.
   * [restoringSession] false leaves the auth provider alone until a sign-in.
   */
  suspend fun start(restoringSession: Boolean = true) {
    vault = vaultStore.load()
    _profile.value = vault.profile
    val root = vault.root
    if (root != null) {
      val verified = (AccountLog.verify(vault.entries, root) as? AccountVerifyResult.Ok)?.state
      if (verified != null && ownMemberLive(verified)) {
        _state.value = verified
        _phase.value = Phase.Ready
        publishHosts()
      }
    }
    if (!restoringSession) {
      if (_phase.value == Phase.Loading) _phase.value = Phase.SignedOut
      return
    }
    try {
      ensureConfigured()
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      if (_phase.value == Phase.Loading) _phase.value = Phase.SignedOut
      return
    }
    refreshProfile()
    when {
      _phase.value == Phase.Ready -> {
        refresh()
        linkLocalHostIfNeeded()
        syncPushRegistration()
      }
      auth.isSignedIn -> bootstrap(null)
      else -> _phase.value = Phase.SignedOut
    }
  }

  /** The app came to the foreground: pick up new entries and moved addresses. */
  suspend fun refresh() {
    if (_phase.value != Phase.Ready) return
    // Still no `/config` (offline since launch): nothing below can reach the service.
    if (!configured) runCatching { ensureConfigured() }
    if (!configured) return
    refreshProfile()
    if (!refreshLog() || checkForResetOverClerk()) return
    flushName()
    refreshDirectory()
    refreshRequests()
  }

  /** Re-read the signed-in person. The session lapses long before the device leaves the account, so the last one seen stays. */
  suspend fun refreshProfile() {
    val current = if (configured && auth.isSignedIn) auth.profile else null
    if (current == null) {
      _profile.value = vault.profile
      return
    }
    _profile.value = current
    if (vault.profile == current) return
    vault = vault.copy(profile = current)
    vaultStore.save(vault)
  }

  /** While a connection to an account host keeps failing, poll the directory so a moved tunnel is found. */
  fun setConnectionFailing(failing: Boolean) {
    retryLoop?.cancel()
    retryLoop = null
    if (!failing) return
    retryLoop = scope.launch {
      while (isActive) {
        delay(30_000)
        refreshDirectory()
      }
    }
  }

  // Sign-in

  suspend fun signIn(provider: AccountSignInProvider) {
    if (provider == AccountSignInProvider.Email) return
    runSignIn(provider) {
      if (provider == AccountSignInProvider.Apple) auth.signInWithApple(null) else auth.signInWithGitHub()
    }
  }

  /** The configured auth provider, before a sign-in button is shown. */
  suspend fun prepare() {
    runCatching { ensureConfigured() }
  }

  suspend fun sendEmailCode(email: String) {
    _error.value = null
    try {
      ensureConfigured()
      if (auth.isSignedIn) {
        runSignIn(AccountSignInProvider.Email) {}
        return
      }
      auth.sendEmailCode(email)
      _awaitingEmailCode.value = true
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      _error.value = describe(e)
    }
  }

  suspend fun verifyEmailCode(code: String) {
    runSignIn(AccountSignInProvider.Email) { auth.verifyEmailCode(code) }
    if (_phase.value != Phase.SignedOut) _awaitingEmailCode.value = false
  }

  fun cancelEmailCode() {
    _awaitingEmailCode.value = false
    _error.value = null
  }

  private suspend fun runSignIn(provider: AccountSignInProvider, flow: suspend () -> Unit) {
    _error.value = null
    _phase.value = Phase.SigningIn
    _signingInWith.value = provider
    try {
      ensureConfigured()
      // A sign-in whose account setup failed is still signed in: retrying sets it up.
      if (!auth.isSignedIn) flow()
      refreshProfile()
    } catch (e: CancellationException) {
      _signingInWith.value = null
      throw e
    } catch (e: Exception) {
      _error.value = describe(e)
      _phase.value = Phase.SignedOut
      _signingInWith.value = null
      return
    }
    _signingInWith.value = null
    bootstrap(provider)
  }

  internal suspend fun ensureConfigured() {
    if (configured) return
    auth.configure(client.config())
    configured = true
  }

  /** Signed in with Clerk: genesis on an empty account, resume when already on it, else wait for approval. */
  internal suspend fun bootstrap(provider: AccountSignInProvider?) {
    _phase.value = Phase.SettingUp
    try {
      val info = client.account()
      val root = vault.root
      if (root != null && (root.accountId != info.accountId || root.epoch != info.epoch) && !followReset(info)) {
        // Another account: the service never takes these keys there.
        vault = AccountVault.EMPTY
      }
      var firstDevice = false
      if (info.headSeq == null) firstDevice = writeGenesis(info)
      if (!firstDevice) {
        when (val outcome = resume(info)) {
          ResumeOutcome.Adopted -> Unit
          ResumeOutcome.NotMember -> {
            _phase.value = Phase.AwaitingApproval
            continueJoin(info, provider)
            return
          }
          is ResumeOutcome.ApprovedUnconfirmed -> {
            _phase.value = Phase.AwaitingApproval
            offerApprovedJoin(outcome.state, outcome.entries, info, provider)
            return
          }
        }
      }
      _removed.value = false
      _signInNeeded.value = null
      _phase.value = Phase.Ready
      refreshProfile()
      publishHosts()
      provider?.let { onEvent(Event.SignedIn(it, firstDevice)) }
      linkLocalHostIfNeeded()
      flushName()
      refreshDirectory()
      syncPushRegistration()
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      _error.value = describe(e)
      // A live member stays on: the sign-in was only ever for proving who you are.
      _phase.value = if (_state.value?.let { ownMemberLive(it) } == true && vault.root != null) Phase.Ready else Phase.SignedOut
    }
  }

  /** The first device on the account (TOFU): its own genesis, pinned. False when another device won the race. */
  private suspend fun writeGenesis(info: AccountInfo): Boolean {
    val keys = currentKeys()
    val signer = keys.signer ?: throw AccountStoreError.Keys
    val genesis = AccountEntryBuilder.make(info.accountId, info.epoch, null, nowMs(), signer, AccountEntryBuilder.Fields.Genesis(keys.member))
    try {
      client.append(info.epoch, listOf(genesis))
    } catch (e: AccountServiceError.Conflict) {
      vault = vault.copy(keys = keys)
      return false
    }
    val verified = (AccountLog.verify(listOf(genesis)) as? AccountVerifyResult.Ok)?.state ?: throw AccountStoreError.Keys
    vault = AccountVault(keys = keys, root = verified.root, entries = listOf(genesis), profile = vault.profile)
    _state.value = verified
    vaultStore.save(vault)
    return true
  }

  internal sealed interface ResumeOutcome {
    data object Adopted : ResumeOutcome
    data object NotMember : ResumeOutcome
    /** This device's keys were approved, but not with a code it confirmed. */
    data class ApprovedUnconfirmed(val state: AccountLogState, val entries: List<dev.houwert.argus.kit.account.AccountEntry>) : ResumeOutcome
  }

  /** This device's key is live in the account's log: adopt it. */
  private suspend fun resume(info: AccountInfo): ResumeOutcome {
    val entries = client.log(info.epoch, -1)
    when (val result = AccountLog.verify(entries, vault.root)) {
      is AccountVerifyResult.Ok -> {
        val verified = result.state
        if (!ownMemberLive(verified)) return ResumeOutcome.NotMember
        // Never pinned: only this device's own genesis, or an approval carrying the code compared here, counts.
        if (vault.root == null && !admitsConfirmedJoin(verified) && !wroteGenesis(verified)) {
          return ResumeOutcome.ApprovedUnconfirmed(verified, entries)
        }
        vault = vault.copy(root = verified.root, joinRequestId = null, joinCommit = null, pendingJoin = null, entries = entries)
        _state.value = verified
        _logError.value = null
        _resetNotice.value = null
        vaultStore.save(vault)
        return ResumeOutcome.Adopted
      }
      is AccountVerifyResult.Rejected -> {
        _logError.value = result.reason
        throw AccountStoreError.UntrustedLog
      }
    }
  }

  internal fun wroteGenesis(state: AccountLogState): Boolean {
    val id = vault.keys?.memberId ?: return false
    return state.members[id]?.addedBy == id
  }

  internal fun ownMemberLive(state: AccountLogState): Boolean {
    val keys = vault.keys ?: return false
    return state.liveMember(keys.memberId)?.member?.signPub == keys.signPub
  }

  /** Sign out = take this device off the account, forget its keys, end the Clerk session. QR pairings are unaffected. */
  suspend fun signOut() {
    (pendingJoin?.requestId ?: vault.pendingJoin?.requestId)?.let { id -> runCatching { client.deny(id) } }
    val memberId = vault.keys?.memberId
    if (_phase.value == Phase.Ready && memberId != null) {
      // Not applied: the store is forgotten right after, and adopting a log without this device reads as removed.
      runCatching {
        appendWithRetry(apply = false) { head ->
          listOf(entry(head, AccountEntryBuilder.Fields.Revoke(memberId, "unlinked")))
        }
      }
    }
    runCatching { auth.signOut() }
    forgetAccount()
    onEvent(Event.SignedOut)
  }

  internal suspend fun forgetAccount() {
    vault = AccountVault.EMPTY
    _signInNeeded.value = null
    vaultStore.save(vault)
    _state.value = null
    _hosts.value = emptyList()
    _profile.value = null
    _link.value = LinkFlow.Idle
    pendingLink = null
    stopJoin()
    approvedJoin = null
    _join.value = JoinFlow.Idle
    _requests.value = emptyList()
    _approval.value = ApprovalFlow.Idle
    pendingApproval = null
    pushFingerprint = null
    _reset.value = ResetFlow.Idle
    _resetNotice.value = null
    _phase.value = Phase.SignedOut
    onHostsChanged(emptyList())
  }

  internal fun nowMs(): Long = now()


  companion object {
    /** How often a visible host list re-reads the directory; well inside the online window. */
    const val PRESENCE_POLL_INTERVAL_MS = 60_000L

    fun describe(error: Throwable): String = when (error) {
      is AccountServiceError -> error.message
      is AccountStoreError -> error.message
      else -> error.message ?: error.javaClass.simpleName
    }

    internal fun accountIdHash(accountId: String) = AccountCodec.sha256Hex(accountId)
  }
}

sealed class AccountStoreError(override val message: String) : Exception(message) {
  data object Keys : AccountStoreError("This device's account keys couldn't be used.")
  data object UntrustedLog : AccountStoreError("The account service sent a log that doesn't check out, so nothing was changed.")
  data object NotReady : AccountStoreError("Sign in first.")
  data object HeadMoved : AccountStoreError("Your account changed while this was open. Try again.")
}

/** The Mac app's bundled host, linked over its local socket with no code. The phone never has one. */
interface AccountLocalHostLinking {
  /** The account the host is already linked to, null when it isn't. */
  suspend fun status(): LocalHostLinkInfo?
  /** The host's member record and its proof of possession. */
  suspend fun begin(): Pair<AccountMember, String>
  /** The `add_host` is in the log; the host fetches, verifies and pins it. */
  suspend fun finish(root: dev.houwert.argus.kit.account.AccountRoot)
  suspend fun unlink()
}
