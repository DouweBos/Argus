import Testing

@testable import ArgusCore

struct DeeplinkTreeTests {
  private func labels(_ list: [ArgusConfigDraft.Deeplink]) -> [String] {
    list.map { $0.isFolder ? "\($0.label)(\(labels($0.children ?? []).joined(separator: ",")))" : $0.label }
  }

  @Test func reordersWithinALevelAndAcrossFolders() {
    let a = ArgusConfigDraft.Deeplink(label: "a", url: "x://a")
    let b = ArgusConfigDraft.Deeplink(label: "b", url: "x://b")
    let inner = ArgusConfigDraft.Deeplink(label: "i", url: "x://i")
    let folder = ArgusConfigDraft.Deeplink(label: "F", children: [inner])
    var tree = [a, b, folder]

    tree.moveDeeplink(b.id, to: .before(a.id))
    #expect(labels(tree) == ["b", "a", "F(i)"])
    tree.moveDeeplink(a.id, to: .append(to: folder.id))
    #expect(labels(tree) == ["b", "F(i,a)"])
    tree.moveDeeplink(a.id, to: .before(inner.id))
    #expect(labels(tree) == ["b", "F(a,i)"])
    tree.moveDeeplink(inner.id, to: .append(to: nil))
    #expect(labels(tree) == ["b", "F(a)", "i"])
  }

  @Test func refusesToDropAFolderIntoItself() {
    let inner = ArgusConfigDraft.Deeplink(label: "i", url: "x://i")
    let folder = ArgusConfigDraft.Deeplink(label: "F", children: [inner])
    var tree = [folder]
    tree.moveDeeplink(folder.id, to: .append(to: folder.id))
    tree.moveDeeplink(folder.id, to: .before(inner.id))
    #expect(labels(tree) == ["F(i)"])
  }
}
