import Foundation

enum Fixtures {
  static func typescript(lines: Int) -> String {
    // ~38 bytes a line, so 50k lines stay under ArgusSyntax's 2 MB highlighting limit.
    let block = [
      "import { useState } from \"react\";",
      "// Loads the profile, cached 30s",
      "export async function load(id: string) {",
      "  const hit = cache.get(id);",
      "  if (hit && !force) return hit;",
      "  const res = await fetch(`/u/${id}`);",
      "  if (!res.ok) throw new Error(\"bad\");",
      "  const body = (await res.json()) as P;",
      "  cache.set(id, body, 30 * 1000);",
      "  return { ...body, at: Date.now() };",
      "}",
      "",
    ]
    var out: [String] = []
    out.reserveCapacity(lines)
    while out.count < lines { out.append(contentsOf: block) }
    return out.prefix(lines).joined(separator: "\n")
  }

  static func residentBytes() -> Int {
    var info = mach_task_basic_info()
    var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
    let kr = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
      }
    }
    return kr == KERN_SUCCESS ? Int(info.resident_size) : 0
  }
}
