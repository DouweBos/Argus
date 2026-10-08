// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "ArgusEditor",
  platforms: [.macOS(.v15)],
  products: [
    .library(name: "ArgusEditor", targets: ["ArgusEditor"])
  ],
  dependencies: [
    .package(url: "https://github.com/CodeEditApp/CodeEditTextView", exact: "0.12.1"),
    .package(path: "../ArgusSyntax"),
    .package(path: "../ArgusCore"),
    .package(path: "../ArgusUI"),
  ],
  targets: [
    .target(
      name: "ArgusEditor",
      dependencies: [
        .product(name: "CodeEditTextView", package: "CodeEditTextView"),
        "ArgusSyntax",
        "ArgusCore",
        "ArgusUI",
      ]
    ),
    .testTarget(name: "ArgusEditorTests", dependencies: ["ArgusEditor"]),
  ]
)
