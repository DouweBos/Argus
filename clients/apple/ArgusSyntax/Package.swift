// swift-tools-version: 6.0
import PackageDescription

/// Grammars whose upstream `Package.swift` drops `scanner.c` (it checks the file relative to the
/// working directory), so they link with missing symbols; we compile their generated C ourselves.
let vendoredGrammars: [(target: String, directory: String)] = [
  ("TreeSitterCSS", "tree-sitter-css"),
  ("TreeSitterJavaScript", "tree-sitter-javascript"),
  ("TreeSitterPython", "tree-sitter-python"),
  ("TreeSitterYAML", "tree-sitter-yaml"),
]

let package = Package(
  name: "ArgusSyntax",
  platforms: [.iOS(.v18), .macOS(.v15)],
  products: [
    .library(name: "ArgusSyntax", targets: ["ArgusSyntax"])
  ],
  dependencies: [
    .package(url: "https://github.com/tree-sitter/swift-tree-sitter", exact: "0.25.0"),
    .package(url: "https://github.com/alex-pinkus/tree-sitter-swift", exact: "0.7.4-with-generated-files"),
    .package(url: "https://github.com/tree-sitter/tree-sitter-typescript", exact: "0.23.2"),
    .package(url: "https://github.com/tree-sitter/tree-sitter-json", exact: "0.24.8"),
    .package(url: "https://github.com/tree-sitter-grammars/tree-sitter-markdown", exact: "0.5.3"),
    .package(url: "https://github.com/fwcd/tree-sitter-kotlin", exact: "0.3.8"),
    .package(url: "https://github.com/tree-sitter/tree-sitter-java", exact: "0.23.5"),
    .package(url: "https://github.com/tree-sitter-grammars/tree-sitter-objc", exact: "3.0.2"),
    .package(url: "https://github.com/tree-sitter/tree-sitter-bash", exact: "0.25.1"),
    .package(url: "https://github.com/tree-sitter/tree-sitter-html", exact: "0.23.2"),
    .package(url: "https://github.com/tree-sitter/tree-sitter-ruby", exact: "0.23.1"),
    .package(url: "https://github.com/tree-sitter/tree-sitter-go", exact: "0.25.0"),
    .package(url: "https://github.com/tree-sitter/tree-sitter-rust", exact: "0.24.2"),
  ],
  targets: [
    .target(
      name: "ArgusSyntax",
      dependencies: [
        .product(name: "SwiftTreeSitter", package: "swift-tree-sitter"),
        .product(name: "TreeSitterSwift", package: "tree-sitter-swift"),
        .product(name: "TreeSitterTypeScript", package: "tree-sitter-typescript"),
        .product(name: "TreeSitterJSON", package: "tree-sitter-json"),
        .product(name: "TreeSitterMarkdown", package: "tree-sitter-markdown"),
        .product(name: "TreeSitterKotlin", package: "tree-sitter-kotlin"),
        .product(name: "TreeSitterJava", package: "tree-sitter-java"),
        .product(name: "TreeSitterObjc", package: "tree-sitter-objc"),
        .product(name: "TreeSitterBash", package: "tree-sitter-bash"),
        .product(name: "TreeSitterHTML", package: "tree-sitter-html"),
        .product(name: "TreeSitterRuby", package: "tree-sitter-ruby"),
        .product(name: "TreeSitterGo", package: "tree-sitter-go"),
        .product(name: "TreeSitterRust", package: "tree-sitter-rust"),
      ] + vendoredGrammars.map { .target(name: $0.target) },
      resources: [.copy("Resources/queries")]
    ),
    .testTarget(name: "ArgusSyntaxTests", dependencies: ["ArgusSyntax"]),
  ]
    + vendoredGrammars.map { grammar in
      .target(
        name: grammar.target,
        path: "Vendor/\(grammar.directory)",
        exclude: ["LICENSE"],
        sources: ["src/parser.c", "src/scanner.c"],
        publicHeadersPath: "include",
        cSettings: [.headerSearchPath("src")]
      )
    }
)
