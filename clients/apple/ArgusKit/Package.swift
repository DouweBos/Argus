// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "ArgusKit",
  platforms: [.iOS(.v18), .macOS(.v15)],
  products: [
    .library(name: "ArgusKit", targets: ["ArgusKit"])
  ],
  targets: [
    .target(name: "ArgusKit"),
    .testTarget(
      name: "ArgusKitTests",
      dependencies: ["ArgusKit"],
      resources: [.process("Fixtures")]
    ),
  ]
)
