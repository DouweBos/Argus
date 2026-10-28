// swift-tools-version: 6.0
import PackageDescription

// The menu-bar item Argus Server and the Mac app share: its model, rendering,
// the pairing/link/approval windows and Open at Login.
let package = Package(
  name: "ArgusMenuBar",
  platforms: [.macOS(.v15)],
  products: [
    .library(name: "ArgusMenuBar", targets: ["ArgusMenuBar"])
  ],
  dependencies: [
    .package(path: "../ArgusCore"),
    .package(path: "../ArgusUI"),
    .package(path: "../ArgusUpdate"),
  ],
  targets: [
    .target(
      name: "ArgusMenuBar",
      dependencies: ["ArgusCore", "ArgusUI", "ArgusUpdate"],
      resources: [.process("Resources")]
    ),
    .testTarget(name: "ArgusMenuBarTests", dependencies: ["ArgusMenuBar"]),
  ]
)
