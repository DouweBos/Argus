import ArgusKit
import Foundation

/// A paired host's repo roots, namespaced by the host that holds them —
/// `argus-host://<hostId>/path/to/repo` — so two machines holding a repo at the
/// same path stay two projects, as Electron keys them by host. The router
/// scopes every root a paired host reports and strips the prefix again from
/// anything sent back to it; this Mac's own roots stay plain paths.
public enum HostScopedPath {
  static let scheme = "argus-host://"

  /// Keys whose string value is a repo root.
  static let rootKeys: Set<String> = ["repoRoot", "repo_root", "projectRoot", "projectPath"]

  public static func scope(_ path: String, on host: HostId) -> String {
    guard host != Hosts.local, path.hasPrefix("/") else { return path }
    return "\(scheme)\(host)\(path)"
  }

  /// The host and the path on it, for a scoped root; nil for a plain path.
  public static func split(_ value: String) -> (host: HostId, path: String)? {
    guard value.hasPrefix(scheme) else { return nil }
    let rest = value.dropFirst(scheme.count)
    guard let slash = rest.firstIndex(of: "/"), slash > rest.startIndex else { return nil }
    return (String(rest[..<slash]), String(rest[slash...]))
  }

  /// The path as its own machine knows it — what to show, never to key by.
  public static func path(_ value: String) -> String {
    split(value)?.path ?? value
  }

  /// Every repo root in a host's answer or event, scoped to that host.
  static func scopeRoots(in value: JSONValue, host: HostId) -> JSONValue {
    guard host != Hosts.local else { return value }
    var budget = 20_000
    return scopeRoots(value, host: host, inProjects: false, depth: 0, budget: &budget)
  }

  /// `inProjects`: items of a `projects` list, whose `path` is their root.
  private static func scopeRoots(
    _ value: JSONValue, host: HostId, inProjects: Bool, depth: Int, budget: inout Int
  ) -> JSONValue {
    guard depth < 8, budget > 0 else { return value }
    budget -= 1
    switch value {
    case .array(let items):
      return .array(items.map {
        scopeRoots($0, host: host, inProjects: inProjects, depth: depth + 1, budget: &budget)
      })
    case .object(var object):
      for (key, child) in object {
        let isRoot = rootKeys.contains(key) || (inProjects && key == "path")
        if isRoot, case .string(let root) = child {
          object[key] = .string(scope(root, on: host))
        } else if case .array = child {
          object[key] = scopeRoots(
            child, host: host, inProjects: key == "projects", depth: depth + 1, budget: &budget)
        } else if case .object = child {
          object[key] = scopeRoots(child, host: host, inProjects: false, depth: depth + 1, budget: &budget)
        }
      }
      return .object(object)
    default:
      return value
    }
  }

  /// Params on their way to a host: every scoped root back to its plain path,
  /// and the host the first one named.
  static func unscope(_ value: JSONValue) -> (JSONValue, HostId?) {
    var host: HostId?
    let plain = unscope(value, host: &host, depth: 0)
    return (plain, host)
  }

  private static func unscope(_ value: JSONValue, host: inout HostId?, depth: Int) -> JSONValue {
    guard depth < 8 else { return value }
    switch value {
    case .string(let string):
      guard let (owner, path) = split(string) else { return value }
      if host == nil { host = owner }
      return .string(path)
    case .array(let items):
      return .array(items.map { unscope($0, host: &host, depth: depth + 1) })
    case .object(let object):
      return .object(object.mapValues { unscope($0, host: &host, depth: depth + 1) })
    default:
      return value
    }
  }
}
