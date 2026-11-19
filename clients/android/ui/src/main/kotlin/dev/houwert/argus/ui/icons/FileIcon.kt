package dev.houwert.argus.ui.icons

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Picks a Material Icon Theme icon for a path the way VS Code does: exact file name, then each
 * dotted suffix longest first (`test.tsx` before `tsx`), then the generic file. Folders go by
 * name, `-open` when expanded. The tables are `assets/FileIcons.json`, shared with ArgusUI.
 */
object FileIcon {
  const val FILE = "file"
  const val FOLDER = "folder"

  class Lookup(
    val fileNames: Map<String, String> = emptyMap(),
    val fileExtensions: Map<String, String> = emptyMap(),
    val folderNames: Map<String, String> = emptyMap(),
    val folderExtensions: Map<String, String> = emptyMap(),
  ) {
    companion object {
      fun parse(json: String): Lookup {
        val root = Json.parseToJsonElement(json).jsonObject
        fun table(key: String) =
          (root[key] as? JsonObject)?.mapValues { it.value.jsonPrimitive.content } ?: emptyMap()
        return Lookup(table("fileNames"), table("fileExtensions"), table("folderNames"), table("folderExtensions"))
      }
    }
  }

  @Volatile private var cached: Lookup? = null

  fun lookup(context: Context): Lookup =
    cached
      ?: runCatching { context.assets.open("FileIcons.json").bufferedReader().use { Lookup.parse(it.readText()) } }
        .getOrDefault(Lookup())
        .also { cached = it }

  /** The icon name for `path`; its last component decides, case-insensitively. */
  fun name(path: String, isDirectory: Boolean = false, isExpanded: Boolean = false, lookup: Lookup): String {
    val base = path.split('/').lastOrNull { it.isNotEmpty() }?.lowercase() ?: path.lowercase()
    if (isDirectory) {
      val icon = lookup.folderNames[base] ?: suffixes(base).firstNotNullOfOrNull { lookup.folderExtensions[it] } ?: FOLDER
      return if (isExpanded) "$icon-open" else icon
    }
    lookup.fileNames[base]?.let { return it }
    return suffixes(base).firstNotNullOfOrNull { lookup.fileExtensions[it] } ?: FILE
  }

  /** Every icon the resolver can return. */
  fun allNames(lookup: Lookup): List<String> {
    val files = (lookup.fileNames.values + lookup.fileExtensions.values + FILE).toSortedSet()
    val folders = (lookup.folderNames.values + lookup.folderExtensions.values + FOLDER).toSortedSet()
    return files.toList() + folders.flatMap { listOf(it, "$it-open") }
  }

  /** `a.test.tsx` → `["test.tsx", "tsx"]`; a dotfile's own name counts (`.env` → `["env"]`). */
  fun suffixes(name: String): List<String> {
    val out = mutableListOf<String>()
    var rest = name
    while (true) {
      val dot = rest.indexOf('.')
      if (dot < 0) break
      rest = rest.substring(dot + 1)
      if (rest.isNotEmpty()) out += rest
    }
    return out
  }

  /**
   * The bundled drawable for an icon name (`folder-src-open` → `R.drawable.fileicon_folder_src_open`).
   * A few have a `_dark` twin, picked by the Argus scheme rather than the system's night mode.
   */
  @SuppressLint("DiscouragedApi")
  fun drawable(context: Context, name: String, dark: Boolean): Int {
    val res = context.resources
    fun id(n: String) = res.getIdentifier("fileicon_" + n.replace('-', '_'), "drawable", context.packageName)
    return (if (dark) id("$name-dark") else 0).takeIf { it != 0 } ?: id(name).takeIf { it != 0 } ?: id(FILE)
  }
}

/**
 * A file or folder's type icon, VS Code style. Decorative: the name beside it says what it is.
 * The colours are the icon set's own artwork, like an app icon, not theme tokens.
 */
@Composable
fun FileTypeIcon(
  path: String,
  modifier: Modifier = Modifier,
  isDirectory: Boolean = false,
  isExpanded: Boolean = false,
  size: Dp = 16.dp,
) {
  val context = LocalContext.current
  val dark = ArgusTheme.colors.isDark
  val id =
    remember(path, isDirectory, isExpanded, dark) {
      FileIcon.drawable(context, FileIcon.name(path, isDirectory, isExpanded, FileIcon.lookup(context)), dark)
    }
  Image(painterResource(id), contentDescription = null, modifier = modifier.size(size))
}

/** A named icon from the set, for the gallery's grid. */
@Composable
internal fun FileTypeIconNamed(name: String, size: Dp = 16.dp) {
  val context = LocalContext.current
  val dark = ArgusTheme.colors.isDark
  Image(painterResource(remember(name, dark) { FileIcon.drawable(context, name, dark) }), name, Modifier.size(size))
}
