// swift-tools-version: 6.0
import PackageDescription

// The only package that imports Clerk; everything else sees `AccountAuthenticating`.
let package = Package(
  name: "ArgusAuth",
  platforms: [.iOS(.v18), .macOS(.v15)],
  products: [
    .library(name: "ArgusAuth", targets: ["ArgusAuth"])
  ],
  dependencies: [
    .package(path: "../ArgusKit"),
    .package(url: "https://github.com/clerk/clerk-ios", .upToNextMinor(from: "1.6.1")),
  ],
  targets: [
    .target(
      name: "ArgusAuth",
      dependencies: ["ArgusKit", .product(name: "ClerkKit", package: "clerk-ios")]
    ),
    .testTarget(name: "ArgusAuthTests", dependencies: ["ArgusAuth"]),
  ]
)
