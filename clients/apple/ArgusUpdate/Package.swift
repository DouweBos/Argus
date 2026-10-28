// swift-tools-version: 6.0
import PackageDescription

// Sparkle for the Mac app and Argus Server: one updater, each app its own feed.
let package = Package(
  name: "ArgusUpdate",
  platforms: [.macOS(.v15)],
  products: [
    .library(name: "ArgusUpdate", targets: ["ArgusUpdate"])
  ],
  dependencies: [
    .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.10.0")
  ],
  targets: [
    .target(name: "ArgusUpdate", dependencies: [.product(name: "Sparkle", package: "Sparkle")]),
    .testTarget(name: "ArgusUpdateTests", dependencies: ["ArgusUpdate"]),
  ]
)
