import Foundation
import Testing

@testable import ArgusUI

#if os(macOS)
  import AppKit
#else
  import UIKit
#endif

@Suite("File icons")
struct FileIconTests {
  private func icon(_ path: String, folder: Bool = false, open: Bool = false) -> String {
    FileIcon.name(forPath: path, isDirectory: folder, isExpanded: open)
  }

  @Test("the manifest loads from the bundle")
  func loads() {
    #expect(FileIcon.lookup.fileExtensions.count > 100)
    #expect(FileIcon.lookup.folderNames.count > 100)
  }

  @Test(
    "exact file names win, case-insensitively",
    arguments: [
      ("package.json", "nodejs"), ("Podfile", "ruby"), ("Gemfile", "gemfile"), ("Dockerfile", "docker"),
      ("LICENSE", "license"), ("CHANGELOG.md", "changelog"), ("tsconfig.json", "tsconfig"),
      ("pnpm-lock.yaml", "pnpm"), ("yarn.lock", "yarn"), ("package-lock.json", "nodejs"), (".gitignore", "git"),
      ("AndroidManifest.xml", "android"), ("vite.config.ts", "vite"), ("eslint.config.js", "eslint"),
      (".prettierrc", "prettier"), ("babel.config.js", "babel"), ("Package.resolved", "lock"),
    ])
  func fileNames(path: String, expected: String) {
    #expect(icon(path) == expected)
    #expect(icon("some/dir/\(path)") == expected)
  }

  @Test(
    "compound extensions beat their last part",
    arguments: [
      ("Button.test.tsx", "test-jsx"), ("api.spec.ts", "test-ts"), ("index.d.ts", "typescript-def"),
      ("util.test.js", "test-js"), ("build.gradle.kts", "kotlin"),
    ])
  func compound(path: String, expected: String) {
    #expect(icon(path) == expected)
  }

  @Test(
    "extensions",
    arguments: [
      ("App.swift", "swift"), ("View.m", "objective-c"), ("View.h", "h"), ("Bridge.mm", "objective-cpp"),
      ("Main.kt", "kotlin"), ("Main.java", "java"), ("index.ts", "typescript"), ("App.tsx", "react_ts"),
      ("App.jsx", "react"), ("index.js", "javascript"), ("data.json", "json"), ("notes.md", "markdown"), ("README.md", "markdown"),
      ("ci.yml", "yaml"), ("mise.toml", "toml"), (".env", "tune"), ("run.sh", "console"), ("x.py", "python"),
      ("Info.plist", "xml"), ("App.entitlements", "xml"), ("Debug.xcconfig", "settings"),
      ("project.pbxproj", "settings"), ("Main.storyboard", "xml"), ("photo.HEIC", "image"), ("logo.svg", "svg"),
      ("Inter.ttf", "font"), ("spec.pdf", "pdf"), ("out.zip", "zip"), ("Podfile.lock", "lock"),
      ("schema.graphql", "graphql"), ("q.sql", "database"), ("t.csv", "table"), ("server.log", "log"),
      ("App.SWIFT", "swift"),
    ])
  func extensions(path: String, expected: String) {
    #expect(icon(path) == expected)
  }

  @Test("unknown files fall back to the generic icon")
  func fallback() {
    #expect(icon("mystery.qqq") == FileIcon.file)
    #expect(icon("NOTHING") == FileIcon.file)
    #expect(icon("") == FileIcon.file)
  }

  @Test("folders go by name and open when expanded")
  func folders() {
    #expect(icon("src", folder: true) == "folder-src")
    #expect(icon("packages/host/src/", folder: true, open: true) == "folder-src-open")
    #expect(icon("__tests__", folder: true) == "folder-test")
    #expect(icon("node_modules", folder: true) == "folder-node")
    #expect(icon(".github", folder: true) == "folder-github")
    #expect(icon("iOS", folder: true) == "folder-ios")
    #expect(icon("Argus.xcodeproj", folder: true) == "folder-ios")
    #expect(icon("Assets.xcassets", folder: true, open: true) == "folder-images-open")
    #expect(icon("whatever", folder: true) == "folder")
    #expect(icon("whatever", folder: true, open: true) == "folder-open")
    #expect(icon("package.json", folder: true) == "folder")
  }

  @Test("dotted suffixes, longest first")
  func suffixes() {
    #expect(FileIcon.suffixes("a.test.tsx") == ["test.tsx", "tsx"])
    #expect(FileIcon.suffixes(".env") == ["env"])
    #expect(FileIcon.suffixes("plain") == [])
    #expect(FileIcon.suffixes("trailing.") == [])
  }

  @Test("every name the resolver can return is a bundled image")
  func everyNameIsBundled() {
    let names = FileIcon.allNames
    #expect(names.count > 100)
    let missing = names.filter { !Self.hasImage($0) }
    #expect(missing.isEmpty, "missing: \(missing)")
  }

  private static func hasImage(_ name: String) -> Bool {
    #if os(macOS)
      FileIcon.bundle.image(forResource: name) != nil
    #else
      UIImage(named: name, in: FileIcon.bundle, compatibleWith: nil) != nil
    #endif
  }
}
