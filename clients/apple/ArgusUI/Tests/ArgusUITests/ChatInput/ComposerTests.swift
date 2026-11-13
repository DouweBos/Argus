import ArgusKit
import Foundation
import Testing
import UniformTypeIdentifiers

@testable import ArgusUI

@Suite("SlashCommandMenu")
struct SlashCommandMenuTests {
  private let commands = SlashCommandMenu.merged([
    .init(name: "review", description: "Review a PR", argumentHint: "<pr>"),
    .init(name: "clear", description: "", argumentHint: ""),
  ])

  @Test("built-ins merge in; an undescribed agent entry doesn't shadow one")
  func merged() {
    #expect(commands.map(\.name).contains("compact"))
    #expect(commands.first { $0.name == "clear" }?.description == "Clear conversation history")
    #expect(commands.map(\.name) == commands.map(\.name).sorted())
  }

  @Test("open only while the first token is typed, contains-filtered, eight at most")
  func suggestions() {
    #expect(SlashCommandMenu.suggestions(for: "/", in: commands).count == 8)
    #expect(SlashCommandMenu.suggestions(for: "/vie", in: commands).map(\.name) == ["review"])
    #expect(SlashCommandMenu.suggestions(for: "/COMP", in: commands).map(\.name) == ["compact"])
    #expect(SlashCommandMenu.suggestions(for: "/review x", in: commands).isEmpty)
    #expect(SlashCommandMenu.suggestions(for: "hi /re", in: commands).isEmpty)
  }

  @Test("accepting fills in the name and a space; the hint shows until an argument")
  func accept() {
    let review = commands.first { $0.name == "review" }!
    let text = SlashCommandMenu.accepted(review)
    #expect(text == "/review ")
    #expect(SlashCommandMenu.argumentHint(for: text, in: commands) == "<pr>")
    #expect(SlashCommandMenu.argumentHint(for: "/review 1", in: commands) == nil)
    #expect(SlashCommandMenu.argumentHint(for: "/clear ", in: commands) == nil)
  }

  @Test("/plan and /model are handled locally, like the desktop")
  func local() {
    #expect(SlashCommandMenu.local("/plan") == .togglePlan)
    #expect(SlashCommandMenu.local(" /model ") == .openModelPicker)
    #expect(SlashCommandMenu.local("/model opus") == .setModel("opus"))
    #expect(SlashCommandMenu.local("/compact") == nil)
    #expect(SlashCommandMenu.local("/usage-limits") == .showUsageLimits)
    #expect(SlashCommandMenu.local("/usage-limits now") == nil)
    #expect(SlashCommandMenu.local("plan") == nil)
  }
}

@Suite("ComposerKeymap")
struct ComposerKeymapTests {
  private func action(_ key: ComposerKey, menu: Bool = false, running: Bool = false)
    -> ComposerKeyAction
  {
    ComposerKeymap.action(for: key, menuOpen: menu, isRunning: running)
  }

  @Test("Return sends, ⇧Return is a newline")
  func returnKey() {
    #expect(action(.returnKey(shift: false)) == .send)
    #expect(action(.returnKey(shift: true)) == .passThrough)
    // Sending while the agent runs queues; the key is the same.
    #expect(action(.returnKey(shift: false), running: true) == .send)
  }

  @Test("an open menu takes the arrows, Tab, Return and Esc")
  func menu() {
    #expect(action(.down, menu: true) == .menuMove(1))
    #expect(action(.up, menu: true) == .menuMove(-1))
    #expect(action(.tab(shift: false), menu: true) == .menuAccept)
    #expect(action(.returnKey(shift: false), menu: true) == .menuAccept)
    #expect(action(.escape, menu: true) == .menuDismiss)
    #expect(action(.returnKey(shift: true), menu: true) == .passThrough)
    #expect(action(.up) == .passThrough)
  }

  @Test("⇧Tab cycles the mode; ⌘. interrupts only a running agent; Esc never does")
  func modeAndInterrupt() {
    #expect(action(.tab(shift: true)) == .cyclePermissionMode)
    #expect(action(.tab(shift: false)) == .passThrough)
    #expect(action(.commandPeriod, running: true) == .interrupt)
    #expect(action(.commandPeriod) == .ignore)
    #expect(action(.escape, running: true) == .ignore)
  }

  @Test("Tab takes a suggested reply, after any open menu")
  func followUp() {
    #expect(
      ComposerKeymap.action(
        for: .tab(shift: false), menuOpen: false, isRunning: false, hasFollowUp: true)
        == .acceptFollowUp)
    #expect(
      ComposerKeymap.action(
        for: .tab(shift: false), menuOpen: true, isRunning: false, hasFollowUp: true)
        == .menuAccept)
    #expect(
      ComposerKeymap.action(
        for: .tab(shift: true), menuOpen: false, isRunning: false, hasFollowUp: true)
        == .cyclePermissionMode)
  }

  @Test("menus clamp")
  func clamp() {
    #expect(ComposerKeymap.move(0, by: -1, count: 3) == 0)
    #expect(ComposerKeymap.move(2, by: 1, count: 3) == 2)
    #expect(ComposerKeymap.move(1, by: 1, count: 3) == 2)
    #expect(ComposerKeymap.move(4, by: 1, count: 0) == 0)
  }
}

@Suite("Composer controls")
struct ComposerControlsTests {
  @Test("native and canonical mode names read the same")
  func canonical() {
    #expect(ComposerPermissionMode.canonical("default") == .ask)
    #expect(ComposerPermissionMode.canonical("acceptEdits") == .review)
    #expect(ComposerPermissionMode.canonical("plan") == .plan)
    #expect(ComposerPermissionMode.canonical(nil) == .auto)
    #expect(ComposerPermissionMode.canonical("bypassPermissions") == .auto)
    #expect(ComposerPermissionMode.label(.review) == "Accept edits")
  }

  @Test("⇧Tab order is auto, ask, plan, review")
  func cycle() {
    var mode = RemotePermissionMode.auto
    var seen: [RemotePermissionMode] = []
    for _ in 0..<4 {
      mode = ComposerPermissionMode.next(after: mode)
      seen.append(mode)
    }
    #expect(seen == [.ask, .plan, .review, .auto])
  }

  @Test("effort adds ultracode beside xhigh and hides without levels")
  func effort() throws {
    let json = """
      [{"value":"a","displayName":"A","description":"","supportsEffort":true,
        "supportedEffortLevels":["low","high","xhigh"]},
       {"value":"b","displayName":"B","description":"","supportsEffort":false}]
      """
    let models = try JSONDecoder().decode([RemoteModelInfo].self, from: Data(json.utf8))
    #expect(ComposerEffort.levels(for: models[0]) == ["low", "high", "xhigh", "ultracode"])
    #expect(ComposerEffort.levels(for: models[1]).isEmpty)
    #expect(ComposerEffort.label(nil) == "Default")
    #expect(ComposerEffort.label("xhigh") == "Extra high")
  }
}

@Suite("ComposerOptions")
struct ComposerOptionsTests {
  private func models(_ values: String...) throws -> [RemoteModelInfo] {
    let json = values.map { "{\"value\":\"\($0)\",\"displayName\":\"\($0)\",\"description\":\"\"}" }
    return try JSONDecoder().decode([RemoteModelInfo].self, from: Data("[\(json.joined(separator: ","))]".utf8))
  }

  @Test("an agent's own models win; without them, another agent's")
  func fallback() throws {
    let own = try models("opus")
    var other = RemoteAgentCapabilities.empty
    other.models = try models("default", "sonnet")
    let byAgent = ["a": .empty, "b": other]
    #expect(ComposerOptions.models(own: own, byAgent: byAgent).map(\.value) == ["opus"])
    #expect(ComposerOptions.models(own: [], byAgent: byAgent).map(\.value) == ["default", "sonnet"])
    #expect(ComposerOptions.models(own: [], byAgent: ["a": .empty]).isEmpty)
  }

  @Test("no pick is the CLI default; an unknown one falls back to the first")
  func current() throws {
    let list = try models("default", "sonnet")
    #expect(ComposerOptions.current(nil, in: list)?.value == "default")
    #expect(ComposerOptions.current("sonnet", in: list)?.value == "sonnet")
    #expect(ComposerOptions.current("gone", in: list)?.value == "default")
  }

  @Test("the session's own project isn't linkable")
  func linkable() throws {
    let json = #"[{"repo_root":"/a","name":"A"},{"repo_root":"/b","name":"B"}]"#
    let projects = try JSONDecoder().decode([RemoteProject].self, from: Data(json.utf8))
    #expect(ComposerOptions.linkable(projects, ownRepoRoot: "/a").map(\.repoRoot) == ["/b"])
    #expect(ComposerOptions.linkable(projects, ownRepoRoot: nil).count == 2)
  }
}

@Suite("ImageAttachments")
struct ImageAttachmentsTests {
  private static let pixel = Data(
    base64Encoded:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
  )!

  @Test("an accepted format goes out byte for byte with its media type")
  func passthrough() throws {
    let pending = try #require(ImageAttachments.pending(data: Self.pixel, type: .png))
    #expect(pending.attachment.mediaType == "image/png")
    #expect(pending.attachment.data == Self.pixel.base64EncodedString())
  }

  // TIFF only comes from AppKit.
  #if os(macOS)
    @Test("anything else is re-encoded as PNG")
    func reencode() throws {
      let tiff = try #require(PlatformImage(data: Self.pixel)?.tiffRepresentation)
      let pending = try #require(ImageAttachments.pending(data: tiff, type: .tiff))
      #expect(pending.attachment.mediaType == "image/png")
      #expect(Data(base64Encoded: pending.attachment.data)?.prefix(4) == Self.pixel.prefix(4))
    }

    @Test("unnamed bytes are typed by sniffing")
    func sniffed() throws {
      let png = try #require(ImageAttachments.pending(data: Self.pixel))
      #expect(png.attachment.mediaType == "image/png")
      #expect(png.attachment.data == Self.pixel.base64EncodedString())
      let tiff = try #require(PlatformImage(data: Self.pixel)?.tiffRepresentation)
      #expect(ImageAttachments.pending(data: tiff)?.attachment.mediaType == "image/png")
      #expect(ImageAttachments.pending(data: Data("nope".utf8)) == nil)
    }
  #endif

  @Test("a camera photo goes out as JPEG, a pasted image as PNG")
  func photo() throws {
    let image = try #require(PlatformImage(data: Self.pixel))
    #expect(ImageAttachments.pending(photo: image)?.attachment.mediaType == "image/jpeg")
    #expect(ImageAttachments.pending(image: image)?.attachment.mediaType == "image/png")
  }

  @Test("non-images are refused")
  func garbage() {
    #expect(ImageAttachments.pending(data: Data("nope".utf8), type: .png) == nil)
    #expect(ImageAttachments.isImage(URL(fileURLWithPath: "/a/b.webp")))
    #expect(!ImageAttachments.isImage(URL(fileURLWithPath: "/a/b.swift")))
  }
}

@Suite("FollowUps")
struct FollowUpsTests {
  private let items = ["Yes, add the tests", "Commit it"]

  @Test("a typed prefix completes, case-insensitively")
  func completion() {
    #expect(FollowUps.completion(for: "yes, add", in: items) == " the tests")
    #expect(FollowUps.completion(for: "Comm", in: items) == "it it")
    #expect(FollowUps.completion(for: "", in: items) == nil)
    #expect(FollowUps.completion(for: "Please", in: items) == nil)
    #expect(FollowUps.completion(for: "Commit it", in: items) == nil)
    #expect(FollowUps.completion(for: "Yes\n", in: items) == nil)
  }

  @Test("Tab fills the completion, or the first reply into an empty input")
  func accepted() {
    #expect(FollowUps.accepted(for: "", in: items) == "Yes, add the tests")
    #expect(FollowUps.accepted(for: "Comm", in: items) == "Commit it")
    #expect(FollowUps.accepted(for: "Please", in: items) == nil)
    #expect(FollowUps.accepted(for: "", in: []) == nil)
  }
}
