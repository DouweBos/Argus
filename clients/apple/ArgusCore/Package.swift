// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "ArgusCore",
  platforms: [.iOS(.v18), .macOS(.v15)],
  products: [
    .library(name: "ArgusCore", targets: ["ArgusCore"])
  ],
  dependencies: [
    .package(path: "../ArgusKit")
  ],
  targets: [
    .target(name: "ArgusCore", dependencies: ["ArgusKit"]),
    .testTarget(name: "ArgusCoreTests", dependencies: ["ArgusCore"]),
  ]
)
