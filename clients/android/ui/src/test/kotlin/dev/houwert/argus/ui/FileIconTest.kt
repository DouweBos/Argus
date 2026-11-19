package dev.houwert.argus.ui

import dev.houwert.argus.ui.icons.FileIcon
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FileIconTest {
  private val lookup = FileIcon.Lookup.parse(File("src/main/assets/FileIcons.json").readText())

  private fun icon(path: String, folder: Boolean = false, open: Boolean = false) = FileIcon.name(path, folder, open, lookup)

  @Test
  fun theManifestLoads() {
    assertTrue(lookup.fileExtensions.size > 100)
    assertTrue(lookup.folderNames.size > 100)
  }

  @Test
  fun exactFileNamesWinCaseInsensitively() {
    val cases =
      listOf(
        "package.json" to "nodejs", "Podfile" to "ruby", "Gemfile" to "gemfile", "Dockerfile" to "docker",
        "LICENSE" to "license", "CHANGELOG.md" to "changelog", "tsconfig.json" to "tsconfig",
        "pnpm-lock.yaml" to "pnpm", "yarn.lock" to "yarn", "package-lock.json" to "nodejs", ".gitignore" to "git",
        "AndroidManifest.xml" to "android", "vite.config.ts" to "vite", "eslint.config.js" to "eslint",
        ".prettierrc" to "prettier", "babel.config.js" to "babel", "Package.resolved" to "lock",
      )
    for ((path, expected) in cases) {
      assertEquals(path, expected, icon(path))
      assertEquals(path, expected, icon("some/dir/$path"))
    }
  }

  @Test
  fun compoundExtensionsBeatTheirLastPart() {
    val cases =
      listOf(
        "Button.test.tsx" to "test-jsx", "api.spec.ts" to "test-ts", "index.d.ts" to "typescript-def",
        "util.test.js" to "test-js", "build.gradle.kts" to "kotlin",
      )
    for ((path, expected) in cases) assertEquals(path, expected, icon(path))
  }

  @Test
  fun extensions() {
    val cases =
      listOf(
        "App.swift" to "swift", "View.m" to "objective-c", "View.h" to "h", "Bridge.mm" to "objective-cpp",
        "Main.kt" to "kotlin", "Main.java" to "java", "index.ts" to "typescript", "App.tsx" to "react_ts",
        "App.jsx" to "react", "index.js" to "javascript", "data.json" to "json", "notes.md" to "markdown",
        "README.md" to "markdown", "ci.yml" to "yaml", "mise.toml" to "toml", ".env" to "tune", "run.sh" to "console",
        "x.py" to "python", "Info.plist" to "xml", "App.entitlements" to "xml", "Debug.xcconfig" to "settings",
        "project.pbxproj" to "settings", "Main.storyboard" to "xml", "photo.HEIC" to "image", "logo.svg" to "svg",
        "Inter.ttf" to "font", "spec.pdf" to "pdf", "out.zip" to "zip", "Podfile.lock" to "lock",
        "schema.graphql" to "graphql", "q.sql" to "database", "t.csv" to "table", "server.log" to "log",
        "App.SWIFT" to "swift",
      )
    for ((path, expected) in cases) assertEquals(path, expected, icon(path))
  }

  @Test
  fun unknownFilesFallBackToTheGenericIcon() {
    assertEquals(FileIcon.FILE, icon("mystery.qqq"))
    assertEquals(FileIcon.FILE, icon("NOTHING"))
    assertEquals(FileIcon.FILE, icon(""))
  }

  @Test
  fun foldersGoByNameAndOpenWhenExpanded() {
    assertEquals("folder-src", icon("src", folder = true))
    assertEquals("folder-src-open", icon("packages/host/src/", folder = true, open = true))
    assertEquals("folder-test", icon("__tests__", folder = true))
    assertEquals("folder-node", icon("node_modules", folder = true))
    assertEquals("folder-github", icon(".github", folder = true))
    assertEquals("folder-ios", icon("iOS", folder = true))
    assertEquals("folder-ios", icon("Argus.xcodeproj", folder = true))
    assertEquals("folder-images-open", icon("Assets.xcassets", folder = true, open = true))
    assertEquals("folder", icon("whatever", folder = true))
    assertEquals("folder-open", icon("whatever", folder = true, open = true))
    assertEquals("folder", icon("package.json", folder = true))
  }

  @Test
  fun dottedSuffixesLongestFirst() {
    assertEquals(listOf("test.tsx", "tsx"), FileIcon.suffixes("a.test.tsx"))
    assertEquals(listOf("env"), FileIcon.suffixes(".env"))
    assertEquals(emptyList<String>(), FileIcon.suffixes("plain"))
    assertEquals(emptyList<String>(), FileIcon.suffixes("trailing."))
  }

  @Test
  fun everyNameTheResolverCanReturnIsABundledDrawable() {
    val names = FileIcon.allNames(lookup)
    assertTrue(names.size > 100)
    val missing = names.filter { !File("src/main/res/drawable/fileicon_${it.replace('-', '_')}.xml").exists() }
    assertTrue("missing: $missing", missing.isEmpty())
  }
}
