import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

private func json(_ text: String) -> JSONValue {
  try! JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
}

struct HostScopedPathTests {
  @Test func scopesRemoteRootsOnly() {
    #expect(HostScopedPath.scope("/repo", on: Hosts.local) == "/repo")
    let scoped = HostScopedPath.scope("/repo", on: "mini")
    #expect(scoped == "argus-host://mini/repo")
    #expect(HostScopedPath.scope(scoped, on: "box") == scoped)
    #expect(HostScopedPath.split(scoped)! == ("mini", "/repo"))
    #expect(HostScopedPath.split("/repo") == nil)
    #expect(HostScopedPath.path(scoped) == "/repo")
  }

  @Test func twoHostsHoldingOnePathStayTwoProjects() {
    let list = json(#"{"projects":[{"repo_root":"/same","name":"same"}]}"#)
    let mini = HostScopedPath.scopeRoots(in: list, host: "mini")
    let box = HostScopedPath.scopeRoots(in: list, host: "box")
    let merged = HostRouter.merge(json(#"{"projects":[{"repo_root":"/same","name":"same"}]}"#), HostRouter.merge(mini, box))
    guard case .object(let object) = merged, case .array(let projects) = object["projects"] else {
      Issue.record("not a project list")
      return
    }
    let roots = projects.compactMap { project -> String? in
      if case .object(let p) = project, case .string(let root) = p["repo_root"] { return root }
      return nil
    }
    #expect(roots == ["/same", "argus-host://mini/same", "argus-host://box/same"])
  }

  @Test func nestedRootsInEventsAreScopedAndOtherPathsLeftAlone() {
    let payload = json(#"{"channel":"x","args":[{"repoRoot":"/r","worktreePath":"/r/wt","session":{"repo_root":"/r"}}]}"#)
    let scoped = HostScopedPath.scopeRoots(in: payload, host: "mini")
    #expect(scoped == json(#"{"channel":"x","args":[{"repoRoot":"argus-host://mini/r","worktreePath":"/r/wt","session":{"repo_root":"argus-host://mini/r"}}]}"#))
  }

  @Test func aHydratedProjectsPathIsItsRoot() {
    let hydrate = json(#"{"projects":[{"path":"/p","name":"p"}],"sessions":[{"path":"/p/wt"}]}"#)
    #expect(HostScopedPath.scopeRoots(in: hydrate, host: "mini")
      == json(#"{"projects":[{"path":"argus-host://mini/p","name":"p"}],"sessions":[{"path":"/p/wt"}]}"#))
  }

  @Test func paramsGoBackAsPlainPathsNamingTheirHost() {
    let (plain, host) = HostScopedPath.unscope(json(#"{"repoRoot":"argus-host://box/r","path":"argus-host://box/r","n":1}"#))
    #expect(plain == json(#"{"repoRoot":"/r","path":"/r","n":1}"#))
    #expect(host == "box")
    let (untouched, none) = HostScopedPath.unscope(json(#"{"repoRoot":"/r"}"#))
    #expect(untouched == json(#"{"repoRoot":"/r"}"#))
    #expect(none == nil)
  }

  @MainActor
  @Test func aScopedRootRoutesToItsHost() {
    let router = HostRouter(local: LocalBackend(socketPath: "/nonexistent/host.sock"))
    #expect(router.host(of: .project, "argus-host://box/r") == "box")
    #expect(router.host(of: .project, "/r") == Hosts.local)
    let (params, host) = HostScopedPath.unscope(json(#"{"repo_root":"argus-host://box/r"}"#))
    #expect(router.destination("sessions.list", params, tier: nil, scopedHost: host) == .remote("box"))
  }
}

struct HostSnapshotFilesTests {
  @Test func snapshotsSurviveARelaunchAndGoWhenForgotten() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("snapshots-\(UUID())")
    defer { try? FileManager.default.removeItem(at: dir) }
    let files = HostSnapshotFiles(directory: dir)
    let projects = json(#"{"projects":[{"repo_root":"argus-host://mini/r","name":"r"}]}"#)
    files.save(["|projects.list|{}": projects], for: "mini")
    files.save(["|projects.list|{}": json("[]")], for: "box")
    #expect(files.loadAll()["mini"]?["|projects.list|{}"] == projects)
    files.remove("mini")
    #expect(files.loadAll()["mini"] == nil)
    #expect(files.loadAll()["box"] != nil)
  }

  @MainActor
  @Test func aRouterLearnsAnOfflineHostsSessionsFromItsSnapshot() {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("snapshots-\(UUID())")
    defer { try? FileManager.default.removeItem(at: dir) }
    let files = HostSnapshotFiles(directory: dir)
    files.save(
      [#"|sessions.list|{"repo_root":"argus-host:\/\/mini\/r"}"#: json(#"{"sessions":[{"id":"s1","repo_root":"argus-host://mini/r"}]}"#)],
      for: "mini")
    let router = HostRouter(local: LocalBackend(socketPath: "/nonexistent/host.sock"), snapshots: files)
    #expect(router.host(of: .session, "s1") == "mini")
  }
}
