#if DEBUG
  import AppKit
  import ArgusCore

  /// A deterministic long chat shaped like a real one: asks, long tool runs with
  /// big outputs, edits, build logs, screenshots, sub-agents, long markdown
  /// answers. `saved` is the chat-history form, `remote` the `agents.transcript` one.
  enum TranscriptFixture {
    struct Call {
      var id: String
      var name: String
      var input: [String: Any]
      var output: String?
      var image: Bool = false
      var isError = false
      var children: [Call] = []
    }

    struct Message {
      var id: String
      var role: String
      var text: [String]
      var calls: [Call] = []
      var images = 0
      var timestamp: Double
    }

    /// `narrated`: each tool call carries a line of the agent's narration, so
    /// every call is a row of its own rather than a folded run, with writes
    /// and edits among them, as a chat that edits a lot reads.
    static func messages(count: Int, narrated: Bool = false) -> [Message] {
      var rng = Rng(seed: 42)
      var out: [Message] = []
      var clock = 1_760_000_000_000.0
      var turn = 0
      func add(_ role: String, _ text: [String], calls: [Call] = [], images: Int = 0) {
        clock += Double(rng.next(1000...20000))
        out.append(Message(id: "fx-\(out.count)", role: role, text: text, calls: calls, images: images, timestamp: clock))
      }
      while out.count < count {
        turn += 1
        add("user", [ask(turn, &rng)], images: turn % 7 == 0 ? 1 : 0)
        add("assistant", ["I'll start by reading the relevant files for step \(turn), then make the change."])
        // Agents work in long runs of tool calls, one message each, with
        // thinking-only messages (nothing to draw) in between.
        let run = turn % 4 == 0 ? rng.next(2...8) : rng.next(12...60)
        for index in 0..<run {
          if narrated {
            let call = index % 4 == 1 ? write(turn, index, &rng) : index % 4 == 3 ? edit(turn, &rng, index) : toolCall(turn: turn, index: index, &rng)
            add("assistant", [sentence(&rng, words: rng.next(6...30)) + "."], calls: [call])
            continue
          }
          add("assistant", [], calls: [toolCall(turn: turn, index: index, &rng)])
          if index % 3 == 0 { add("assistant", []) }
        }
        if turn % 3 == 0 {
          add("assistant", [], calls: [edit(turn, &rng)])
        }
        if turn % 5 == 0 {
          add(
            "assistant", ["Running the full build to check nothing else broke."],
            calls: [
              Call(
                id: "c-\(turn)-build", name: "Bash",
                input: ["command": "xcodebuild -scheme ArgusDesktop build 2>&1 | tail -1200"],
                output: log(lines: rng.next(600...1500), &rng), isError: turn % 10 == 0)
            ])
        }
        if turn % 13 == 0 {
          add(
            "assistant", [],
            calls: [
              Call(
                id: "c-\(turn)-agent", name: "Agent",
                input: ["subagent_type": "Explore", "description": "Find callers", "prompt": "Find every caller of render()."],
                output: answer(turn, &rng, short: true),
                children: (0..<4).map { toolCall(turn: turn, index: 100 + $0, &rng) })
            ])
        }
        add("assistant", [answer(turn, &rng, short: false)])
      }
      return Array(out.prefix(count))
    }

    // MARK: Forms

    /// What the host saves in `.argus-chat-history/<id>.json`.
    static func saved(_ messages: [Message]) -> [[String: Any]] {
      messages.map { message in
        var raw: [String: Any] = [
          "id": message.id, "role": message.role, "textBlocks": message.text,
          "timestamp": message.timestamp, "toolCalls": message.calls.map(savedCall),
        ]
        if message.images > 0 {
          raw["images"] = (0..<message.images).map { _ in ["data": image(message.id.utf8.reduce(0) { $0 &+ Int($1) }), "media_type": "image/png"] }
        }
        return raw
      }
    }

    private static func savedCall(_ call: Call) -> [String: Any] {
      var raw: [String: Any] = ["id": call.id, "name": call.name, "input": call.input]
      if call.image {
        raw["result"] = [["type": "image", "source": ["type": "base64", "media_type": "image/png", "data": image(call.id.utf8.reduce(0) { $0 &+ Int($1) })]]]
      } else if let output = call.output {
        raw["result"] = output
      }
      if call.isError { raw["isError"] = true }
      if !call.children.isEmpty {
        raw["children"] = call.children.map { ["kind": "tool_use", "toolCall": savedCall($0)] }
      }
      return raw
    }

    /// The `agents.transcript` form of the same messages.
    static func remote(_ messages: [Message]) -> [RemoteMessage] {
      let json: [[String: Any]] = messages.map { message in
        var remote: [String: Any] = [
          "id": message.id, "role": message.role,
          "text_blocks": message.text.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty },
          "timestamp": message.timestamp, "tool_calls": message.calls.map { remoteCall($0, message: message.id) },
        ]
        if message.images > 0 {
          remote["images"] = (0..<message.images).map { ["image_id": "\(message.id):msg:\($0)", "media_type": "image/png"] }
        }
        return remote
      }
      let data = try! JSONSerialization.data(withJSONObject: json)
      return try! JSONDecoder().decode([RemoteMessage].self, from: data)
    }

    private static func remoteCall(_ call: Call, message: String) -> [String: Any] {
      var blocks: [[String: Any]] = []
      if call.image {
        blocks = [["type": "image", "image_id": "\(message):\(call.id):0", "media_type": "image/png"]]
      } else if let output = call.output, !output.isEmpty {
        blocks = [["type": "text", "text": output]]
      }
      var remote: [String: Any] = [
        "id": call.id, "name": call.name, "input": call.input, "result_blocks": blocks,
        "status": call.isError ? "error" : "done",
      ]
      if call.isError { remote["is_error"] = true }
      if !call.children.isEmpty {
        remote["children"] = call.children.map { ["kind": "tool_use", "tool_call": remoteCall($0, message: message)] }
      }
      return remote
    }

    // MARK: Content

    private static let words = """
      the transcript view renders every message lazily and reuses its rows while the reader scrolls back \
      through history so a long chat should never stall the main thread when layout runs again after a \
      resize or a stream update lands at the bottom of the list where the agent keeps writing output
      """.split(separator: " ").map(String.init)

    private static func sentence(_ rng: inout Rng, words count: Int) -> String {
      (0..<count).map { _ in words[rng.next(0...(words.count - 1))] }.joined(separator: " ")
    }

    private static func ask(_ turn: Int, _ rng: inout Rng) -> String {
      if turn % 4 == 0 {
        return (0..<rng.next(3...8)).map { _ in sentence(&rng, words: rng.next(20...60)) + "." }
          .joined(separator: "\n\n") + "\n\nSee `Sources/App/Module\(turn).swift:\(turn)` for the needle."
      }
      return "Please fix the needle in step \(turn): " + sentence(&rng, words: rng.next(8...30)) + "."
    }

    private static func toolCall(turn: Int, index: Int, _ rng: inout Rng) -> Call {
      let id = "c-\(turn)-\(index)"
      switch (turn + index) % 6 {
      case 0, 1:
        let path = "/tmp/argus/Sources/Module\(turn % 23)/File\(index).swift"
        return Call(id: id, name: "Read", input: ["file_path": path], output: source(lines: rng.next(80...400), &rng))
      case 2:
        let hits = (0..<rng.next(10...80)).map { "Sources/Module\($0 % 17)/File\($0).swift:\($0 * 7): let needle = render(\($0))" }
        return Call(id: id, name: "Grep", input: ["pattern": "render\\(", "path": "Sources"], output: hits.joined(separator: "\n"))
      case 3:
        return Call(
          id: id, name: "Bash", input: ["command": "swift test --filter Module\(turn) 2>&1 | tail -400"],
          output: log(lines: rng.next(40...400), &rng), isError: turn % 17 == 0)
      case 4 where turn % 9 == 0:
        return Call(id: id, name: "Read", input: ["file_path": "/tmp/argus/screenshot-\(turn).png"], image: true)
      default:
        let files = (0..<rng.next(5...60)).map { "Sources/Module\(turn % 23)/File\($0).swift" }
        return Call(id: id, name: "Glob", input: ["pattern": "Sources/**/*.swift"], output: files.joined(separator: "\n"))
      }
    }

    private static func write(_ turn: Int, _ index: Int, _ rng: inout Rng) -> Call {
      Call(
        id: "c-\(turn)-write-\(index)", name: "Write",
        input: ["file_path": "/tmp/argus/Sources/Module\(turn % 23)/New\(index).swift", "content": source(lines: rng.next(10...70), &rng)],
        output: "File created successfully.")
    }

    private static func edit(_ turn: Int, _ rng: inout Rng, _ index: Int = -1) -> Call {
      let old = source(lines: rng.next(5...40), &rng)
      let new = source(lines: rng.next(5...40), &rng)
      return Call(
        id: index < 0 ? "c-\(turn)-edit" : "c-\(turn)-edit-\(index)", name: "Edit",
        input: [
          "file_path": turn % 2 == 0 ? "/Users/someone/Work/Projects/Argus/.gitignore" : "/tmp/argus/Sources/Module\(turn % 23)/View.swift",
          "old_string": old, "new_string": new,
        ],
        output: "The file has been updated.")
    }

    private static func source(lines: Int, _ rng: inout Rng) -> String {
      (1...lines).map { line in
        let indent = String(repeating: "  ", count: line % 4)
        return switch line % 7 {
        case 0: "\(line)\t\(indent)// \(sentence(&rng, words: rng.next(4...14)))"
        case 1: "\(line)\t\(indent)func render\(line)(_ value: Int) -> String {"
        case 6: "\(line)\t\(indent)}"
        default: "\(line)\t\(indent)let value\(line) = compute(\(line), \"\(sentence(&rng, words: rng.next(1...6)))\")"
        }
      }.joined(separator: "\n")
    }

    private static func log(lines: Int, _ rng: inout Rng) -> String {
      (1...lines).map { line in
        switch line % 9 {
        case 0: "Sources/Module\(line % 17)/File\(line).swift:\(line):9: warning: \(sentence(&rng, words: rng.next(4...12)))"
        case 1: "CompileSwift normal arm64 /tmp/argus/Sources/Module\(line % 17)/File\(line).swift"
        default: "[\(line)/\(lines)] \(sentence(&rng, words: rng.next(3...16)))"
        }
      }.joined(separator: "\n")
    }

    private static func answer(_ turn: Int, _ rng: inout Rng, short: Bool) -> String {
      var parts = ["## Step \(turn)", "I changed **Sources/App/Module\(turn).swift:\(turn)** and the `HostStore`."]
      for section in 0..<(short ? 1 : rng.next(2...5)) {
        parts.append("### Part \(section + 1)")
        parts.append((0..<rng.next(2...5)).map { _ in sentence(&rng, words: rng.next(20...70)) + "." }.joined(separator: " "))
        parts.append(
          (0..<rng.next(2...6)).map { item in
            "- `item\(item)` in ./Sources/Module\(item)/File\(turn).swift — \(sentence(&rng, words: rng.next(5...20))) ([docs](https://example.com/\(turn)/\(item)))"
          }.joined(separator: "\n"))
        if section % 2 == 0 {
          parts.append("```swift\n" + source(lines: rng.next(10...70), &rng) + "\n```")
        }
      }
      if !short, turn % 2 == 0 {
        parts.append(
          "| File | Change | Lines |\n|---|---|---|\n"
            + (0..<rng.next(3...10)).map { "| File\($0).swift | \(sentence(&rng, words: 4)) | \($0 * 13) |" }
            .joined(separator: "\n"))
      }
      if !short {
        parts.append("To reclaim the space, run:\n\n```sh\nrm -rf ~/Work/Projects/Argus/clients/argus-\(turn)\n```")
        parts.append(fence(turn))
      }
      parts.append("The needle for step \(turn) is fixed.")
      return parts.joined(separator: "\n\n")
    }

    /// Fences in the languages chats show most, one unknown, one bare, and
    /// lines too long to wrap.
    private static func fence(_ turn: Int) -> String {
      switch turn % 5 {
      case 0:
        return "```json\n{\n  \"name\": \"argus\",\n  \"version\": \(turn),\n  \"private\": true,\n  \"scripts\": { \"build\": \"tsc --noEmit && vite build --mode production --config vite.config.ts --emptyOutDir\" }\n}\n```"
      case 1:
        return "```ts\n// step \(turn)\nexport async function load(id: string): Promise<number> {\n  const value = await fetch(`/api/items/${id}?include=children,parents,siblings,cousins,ancestors,descendants`);\n  return value.status === 200 ? 1 : 0;\n}\n```"
      case 2:
        return "```diff\n- let old = \(turn)\n+ let new = \(turn + 1)\n```"
      case 3:
        return "```brainfuck\n++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.>---.+++++++..+++.\n```"
      default:
        return "```\nplain fenced output \(turn) with no language at all, and a line long enough that it should scroll sideways rather than wrap\n```"
      }
    }

    // MARK: Images

    nonisolated(unsafe) private static var images: [Int: String] = [:]

    /// One of a few PNG screenshots, base64.
    private static func image(_ seed: Int) -> String {
      let variant = abs(seed) % 3
      if let cached = images[variant] { return cached }
      let width = 900, height = 560 + variant * 120
      let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
      NSGraphicsContext.saveGraphicsState()
      NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
      let hues: [CGFloat] = [0.58, 0.08, 0.35]
      for row in 0..<14 {
        NSColor(hue: hues[variant], saturation: 0.4, brightness: 0.4 + CGFloat(row) * 0.04, alpha: 1).setFill()
        NSRect(x: 0, y: row * height / 14, width: width, height: height / 14 + 1).fill()
      }
      NSGraphicsContext.restoreGraphicsState()
      let base64 = rep.representation(using: .png, properties: [:])!.base64EncodedString()
      images[variant] = base64
      return base64
    }

    struct Rng {
      var state: UInt64
      init(seed: UInt64) { state = seed }
      mutating func next(_ range: ClosedRange<Int>) -> Int {
        state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
        return range.lowerBound + Int((state >> 33) % UInt64(range.count))
      }
    }
  }
#endif
