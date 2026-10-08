// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "ArgusEditor",
  platforms: [.macOS(.v15)],
  products: [
    .library(name: "ArgusEditor", targets: ["ArgusEditor"])
  ],
  dependencies: [
    // CodeEditTextView's own dependencies, with its constraints; the view itself is vendored (Vendor/CodeEditTextView).
    .package(url: "https://github.com/ChimeHQ/TextStory", from: "0.9.0"),
    .package(url: "https://github.com/apple/swift-collections.git", from: "1.0.0"),
    .package(path: "../ArgusSyntax"),
    .package(path: "../ArgusCore"),
    .package(path: "../ArgusUI"),
  ],
  targets: [
    .target(
      name: "ArgusEditor",
      dependencies: [
        "CodeEditTextView",
        "ArgusSyntax",
        "ArgusCore",
        "ArgusUI",
      ]
    ),
    .target(
      name: "CodeEditTextView",
      dependencies: [
        "TextStory",
        .product(name: "Collections", package: "swift-collections"),
        "CodeEditTextViewObjC",
      ],
      path: "Vendor/CodeEditTextView/CodeEditTextView",
      swiftSettings: [.swiftLanguageMode(.v5)]
    ),
    .target(
      name: "CodeEditTextViewObjC",
      path: "Vendor/CodeEditTextView/CodeEditTextViewObjC",
      publicHeadersPath: "include"
    ),
    .testTarget(name: "ArgusEditorTests", dependencies: ["ArgusEditor"]),
  ]
)
