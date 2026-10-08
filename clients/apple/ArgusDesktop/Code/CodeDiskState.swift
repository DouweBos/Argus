import Foundation

/// One open file's buffer against the file on disk: which hash the buffer
/// was loaded from, and what to do when the disk moves on. Pure, so the
/// conflict flow is testable without a host.
struct CodeDiskState: Equatable {
  enum Banner: Equatable {
    /// The file changed while the buffer had edits.
    case changedOnDisk
    /// A save found the file changed since it was read.
    case saveConflict
  }

  /// What the panel should do with a change notice.
  enum Reaction: Equatable {
    case none
    /// A clean buffer: take the disk's text, flashing what changed.
    case reload
    /// A dirty buffer: keep both sides, ask.
    case showBanner
    /// Gone from disk: strike the tab through; saving recreates it.
    case markDeleted
  }

  /// The disk content the buffer was read from or last saved as; nil while the file doesn't exist.
  private(set) var baseHash: String?
  private(set) var isDeleted = false
  private(set) var banner: Banner?
  /// "Keep Mine": the next save overwrites whatever is on disk.
  private(set) var forceNextSave = false
  /// The banner was raised at least once, for `had_conflict` on the next save.
  private(set) var hadConflict = false

  init(baseHash: String?) {
    self.baseHash = baseHash
  }

  /// The file was read (first open or a reload).
  mutating func loaded(hash: String) {
    baseHash = hash
    isDeleted = false
    banner = nil
    forceNextSave = false
  }

  /// `code:file-changed`: nil `hash` means deleted.
  mutating func diskChanged(hash: String?, isDirty: Bool) -> Reaction {
    guard let hash else {
      guard !isDeleted else { return .none }
      isDeleted = true
      baseHash = nil
      return .markDeleted
    }
    if hash == baseHash {
      isDeleted = false
      return .none
    }
    if isDirty || forceNextSave {
      isDeleted = false
      // Mine was kept against an older disk version; this one is new, so ask again.
      forceNextSave = false
      raise(.changedOnDisk)
      return .showBanner
    }
    return .reload
  }

  /// What `code_write_file` should send.
  var saveRequest: (baseHash: String?, force: Bool) {
    (isDeleted ? nil : baseHash, forceNextSave)
  }

  /// A save landed.
  mutating func saved(hash: String) {
    loaded(hash: hash)
    hadConflict = false
  }

  /// A save was refused: the disk isn't what the buffer was based on.
  mutating func saveConflicted(diskHash: String?) {
    if diskHash == nil {
      isDeleted = true
      baseHash = nil
    }
    raise(.saveConflict)
  }

  /// Keep the buffer; the next save wins.
  mutating func keepMine() {
    banner = nil
    forceNextSave = true
  }

  private mutating func raise(_ banner: Banner) {
    self.banner = banner
    hadConflict = true
  }
}
