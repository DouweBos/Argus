// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "ArgusUI",
  platforms: [.iOS(.v18), .macOS(.v15)],
  products: [
    .library(name: "ArgusUI", targets: ["ArgusUI"])
  ],
  dependencies: [
    .package(path: "../ArgusKit"),
    .package(path: "../ArgusCore"),
  ],
  targets: [
    .target(name: "ArgusUI", dependencies: ["ArgusKit", "ArgusCore"]),
    .testTarget(name: "ArgusUITests", dependencies: ["ArgusUI"]),
  ]
)
