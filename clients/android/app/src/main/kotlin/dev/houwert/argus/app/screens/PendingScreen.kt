package dev.houwert.argus.app.screens

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import dev.houwert.argus.app.navigation.Route

/** Stands in for a screen a later wave builds; never shipped. */
@Composable
fun PendingScreen(route: Route) {
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
    Text(route::class.simpleName ?: "Screen", style = MaterialTheme.typography.titleMedium)
  }
}
