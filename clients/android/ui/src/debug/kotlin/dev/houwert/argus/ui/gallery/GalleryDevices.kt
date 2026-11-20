package dev.houwert.argus.ui.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.DividedColumn
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.panel
import dev.houwert.argus.ui.devices.DeviceRow
import dev.houwert.argus.ui.devices.TVRemoteView
import dev.houwert.argus.ui.theme.ArgusTheme

@Composable
internal fun DevicesPage() {
  Story("Device rows") {
    DividedColumn(Modifier.panel()) {
      DeviceRow("iPhone 17 Pro", "iOS 26.1", booted = true, isTv = false, live = true, onClick = {})
      DeviceRow("Pixel 9", "Android 16", booted = true, isTv = false, live = false, onClick = {})
      DeviceRow("Apple TV 4K", "tvOS 26.0", booted = true, isTv = true, live = false, onClick = {})
      DeviceRow("iPad Air 13-inch", "iOS 26.1 · Stopped", booted = false, isTv = false, live = false, onClick = {})
    }
  }
  Story("Stage placeholder") {
    Box(Modifier.fillMaxWidth().height(160.dp).background(ArgusTheme.colors.mediaBg), contentAlignment = Alignment.Center) {
      MutedText("Connecting to device")
    }
  }
  Story("TV remote, Apple") { TVRemoteView(press = {}, isAndroid = false, modifier = Modifier.align(Alignment.CenterHorizontally)) }
  Story("TV remote, Android") { TVRemoteView(press = {}, isAndroid = true, modifier = Modifier.align(Alignment.CenterHorizontally)) }
}
