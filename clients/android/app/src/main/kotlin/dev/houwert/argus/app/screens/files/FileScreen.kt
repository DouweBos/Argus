package dev.houwert.argus.app.screens.files

import android.content.Intent
import android.text.format.Formatter
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.core.files.SessionFilePaths
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.listFiles
import dev.houwert.argus.core.stores.readFile
import dev.houwert.argus.core.stores.readFileBytes
import dev.houwert.argus.core.stores.readFileRange
import dev.houwert.argus.core.files.LargeFilePager
import dev.houwert.argus.ui.files.LargeFileView
import dev.houwert.argus.core.files.FilePreviewKind
import dev.houwert.argus.app.telemetry.Telemetry
import dev.houwert.argus.app.telemetry.TelemetryEvent
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.CodeFile
import dev.houwert.argus.kit.protocol.generated.CodeReadOnlyReason
import dev.houwert.argus.ui.code.CodeView
import dev.houwert.argus.ui.components.ControlRequiredBanner
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.TextKeyboard
import dev.houwert.argus.ui.icons.FileTypeIcon
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.syntax.SyntaxLanguage
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/**
 * One session file, read-only and highlighted. [path] is as the link had it: an absolute path is
 * placed in the worktree by matching the session's file list.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileScreen(sessionId: String, path: String, line: Int?) {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val host = app.host
  val theme = ArgusTheme.colors
  val context = LocalContext.current
  val clipboard = LocalClipboardManager.current
  val connection by host.connection.collectAsState()
  val capabilities by host.capabilities.collectAsState()
  val hasControl = "control" in capabilities
  var file by remember { mutableStateOf<CodeFile?>(null) }
  val preview = remember(path) { FilePreviewKind.of(path) }
  /** A PDF's or an image's bytes. */
  var bytes by remember { mutableStateOf<ByteArray?>(null) }
  var showSource by remember { mutableStateOf(false) }
  /** An HTML page may load from the web; off until asked, for this visit only. */
  var allowNetwork by remember { mutableStateOf(false) }
  var reportedPreview by remember { mutableStateOf(false) }
  val reportKind = { kind: FilePreviewKind? ->
    if (!reportedPreview && kind != null) {
      reportedPreview = true
      Telemetry.capture(TelemetryEvent.PreviewOpened(kind))
    }
  }
  val reportPreview = { reportKind(preview) }
  /** A file too large for `files.read`, a page at a time. */
  var pager by remember { mutableStateOf<LargeFilePager?>(null) }
  var relativePath by remember { mutableStateOf<String?>(null) }
  var failure by remember { mutableStateOf<String?>(null) }
  var focusLine by remember { mutableStateOf(line) }
  var jumping by remember { mutableStateOf(false) }
  var menu by remember { mutableStateOf(false) }
  val shownPath = relativePath ?: path
  val language = remember(shownPath, file) { SyntaxLanguage.detect(shownPath, file?.content?.substringBefore('\n')) }
  val lineCount = (file?.content?.count { it == '\n' } ?: 0) + 1

  LaunchedEffect(connection == Transport.State.Ready, hasControl) {
    if (file != null || bytes != null || connection != Transport.State.Ready || !hasControl) return@LaunchedEffect
    load(host, sessionId, path, relativePath, preview?.isBinary == true, { relativePath = it }, { loaded ->
      when (loaded) {
        is CodeFile -> {
          file = loaded
          val relative = relativePath ?: path
          if (loaded.readOnlyReason == CodeReadOnlyReason.tooLarge) {
            pager = LargeFilePager(loaded.size) { offset, length -> host.readFileRange(sessionId, relative, offset, length) }
          }
        }
        is ByteArray -> bytes = loaded
      }
      failure = null
    }, { failure = it })
  }

  Column(Modifier.fillMaxSize().background(theme.bg)) {
    TopAppBar(
      title = {
        Column {
          Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            FileTypeIcon(shownPath)
            Text(SessionFilePaths.fileName(shownPath), color = theme.text, style = argusFont(15, FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
          }
          val subtitle = listOf(SessionFilePaths.directory(shownPath), language?.displayName.orEmpty()).filter { it.isNotEmpty() }.joinToString(" · ")
          if (subtitle.isNotEmpty()) Text(subtitle, color = theme.textMuted, style = argusFont(11), maxLines = 1, overflow = TextOverflow.StartEllipsis)
        }
      },
      navigationIcon = { IconButton(router::pop) { Icon(Icon.arrowBack, "Back") } },
      actions = {
        if (preview?.isRenderedText == true && file?.readOnlyReason == null && file != null) {
          IconButton({ showSource = !showSource }) {
            Icon(if (showSource) Icon.eye else Icon.source, if (showSource) "Show Preview" else "Show Source")
          }
        }
        Box {
          IconButton({ menu = true }) { Icon(Icon.ellipsis, "File actions") }
          DropdownMenu(menu, { menu = false }) {
            val readable = file?.takeIf { it.readOnlyReason == null }
            if (readable != null) {
              if (preview == FilePreviewKind.Html && !showSource) {
                DropdownMenuItem(
                  { Text(if (allowNetwork) "Block Network" else "Allow Network") },
                  { menu = false; allowNetwork = !allowNetwork },
                )
              }
              if (preview?.isRenderedText != true || showSource) {
                DropdownMenuItem({ Text("Go to Line") }, { menu = false; jumping = true })
              }
              DropdownMenuItem({ Text("Copy Contents") }, { menu = false; clipboard.setText(AnnotatedString(readable.content)) })
              DropdownMenuItem({ Text("Share") }, {
                menu = false
                val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, readable.content)
                  .putExtra(Intent.EXTRA_SUBJECT, SessionFilePaths.fileName(shownPath))
                context.startActivity(Intent.createChooser(send, null))
              })
            }
            DropdownMenuItem({ Text("Copy Path") }, { menu = false; clipboard.setText(AnnotatedString(shownPath)) })
          }
        }
      },
      colors = TopAppBarDefaults.topAppBarColors(containerColor = theme.bg, titleContentColor = theme.text, navigationIconContentColor = theme.text, actionIconContentColor = theme.textSecondary),
      windowInsets = WindowInsets(0, 0, 0, 0),
    )
    val current = file
    val data = bytes
    when {
      !hasControl -> Screen { ControlRequiredBanner("read files") }
      failure != null -> EmptyState(Icon.warning, "Can't open this file", body = failure)
      data != null && preview != null -> BinaryFilePreview(preview, shownPath, data, reportPreview)
      pager != null -> {
        LaunchedEffect(Unit) { reportKind(FilePreviewKind.Large) }
        LargeFileView(pager!!)
      }
      current != null && current.readOnlyReason == null && preview == FilePreviewKind.Notebook && !showSource ->
        NotebookFilePreview(host, sessionId, shownPath, current.content, reportPreview)
      current != null && current.readOnlyReason == null && preview == FilePreviewKind.Html && !showSource ->
        HtmlFilePreview(host, sessionId, shownPath, current.content, allowNetwork, reportPreview)
      current != null && current.readOnlyReason == null && preview == FilePreviewKind.Markdown && !showSource ->
        MarkdownFilePreview(host, sessionId, shownPath, current.content, reportPreview)
      current?.readOnlyReason != null -> EmptyState(Icon.file, "Nothing to show", body = message(current.readOnlyReason!!, Formatter.formatShortFileSize(context, current.size.toLong())))
      current != null -> CodeView(current.content, language, focusLine = focusLine)
      else -> Loading("Opening file")
    }
  }

  if (jumping) {
    var text by remember { mutableStateOf(focusLine?.toString().orEmpty()) }
    AlertDialog(
      { jumping = false },
      title = { Text("Go to line") },
      text = { ThemedTextField(text, { text = it }, "1–$lineCount", keyboard = TextKeyboard.DecimalPad) },
      confirmButton = {
        TextButton({
          text.trim().toIntOrNull()?.let { focusLine = it.coerceIn(1, lineCount) }
          jumping = false
        }) { Text("Go") }
      },
      dismissButton = { TextButton({ jumping = false }) { Text("Cancel") } },
    )
  }
}

private suspend fun load(
  host: HostStore,
  sessionId: String,
  path: String,
  known: String?,
  binary: Boolean,
  resolved: (String) -> Unit,
  loaded: (Any) -> Unit,
  failed: (String) -> Unit,
) {
  var relative = known
  if (relative == null) {
    val files = if (SessionFilePaths.needsFileList(path)) host.listFiles(sessionId) else emptyList()
    relative = SessionFilePaths.relative(path, files)
      ?: return failed("This file isn't part of the session's worktree, so it can't be opened here.")
    resolved(relative)
  }
  try {
    loaded(if (binary) host.readFileBytes(sessionId, relative) else host.readFile(sessionId, relative))
  } catch (e: Exception) {
    if (HostStore.isCancellation(e)) throw e
    failed(HostStore.describe(e))
  }
}

private fun message(reason: CodeReadOnlyReason, size: String) = when (reason) {
  CodeReadOnlyReason.binary -> "This is a binary file."
  CodeReadOnlyReason.encoding -> "This file isn't UTF-8 text, so it can't be shown."
  CodeReadOnlyReason.tooLarge -> "At $size this file is too large to show on a phone."
  else -> "This file can't be shown."
}
