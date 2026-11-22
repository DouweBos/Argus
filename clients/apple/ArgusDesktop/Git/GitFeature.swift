import GroveKit

extension GitFeature {
  /// The host's `requireProjectScope` commands, by what they'd do.
  static let projectRootOnly: Set<GitFeature> = [
    .createBranch, .editBranches, .checkout, .merge, .rebase, .tag, .remotes, .submodules, .bisect,
  ]
  static let localOnly: Set<GitFeature> = [.reveal, .trash, .export, .applyPatch]
  /// Dialog options the host's commands have no parameter for.
  static let notOnTheHost: Set<GitFeature> = [.skipHooks, .autostash, .cancel]
}

extension GitFeatures {
  /// What one session's git can do: the host's rules, and whether its files are on this Mac.
  static func argus(isProjectRoot: Bool, isRemote: Bool) -> GitFeatures {
    var features = GitFeatures.all
    features.remove(GitFeature.notOnTheHost, reason: "Argus doesn't offer this")
    if !isProjectRoot { features.remove(GitFeature.projectRootOnly, reason: "Only in the project root") }
    if isRemote { features.remove(GitFeature.localOnly, reason: "Only for repositories on this Mac") }
    return features
  }
}
