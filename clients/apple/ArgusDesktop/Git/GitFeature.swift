/// What one session's git can do. The host refuses these outside the project root,
/// and a paired host's files aren't on this Mac.
enum GitFeature: CaseIterable, Hashable {
  case createBranch, editBranches, checkout, merge, rebase, push, tag, remotes
  case submodules, bisect
  case reveal, trash, export, applyPatch

  /// The host's `requireProjectScope` commands, by what they'd do.
  static let projectRootOnly: Set<GitFeature> = [
    .createBranch, .editBranches, .checkout, .merge, .rebase, .tag, .remotes, .submodules, .bisect,
  ]
  static let localOnly: Set<GitFeature> = [.reveal, .trash, .export, .applyPatch]

  static func supported(isProjectRoot: Bool, isRemote: Bool) -> Set<GitFeature> {
    var features = Set(allCases)
    if !isProjectRoot { features.subtract(projectRootOnly) }
    if isRemote { features.subtract(localOnly) }
    return features
  }

  var unavailableReason: String {
    Self.localOnly.contains(self) ? "Only for repositories on this Mac" : "Only in the project root"
  }
}
