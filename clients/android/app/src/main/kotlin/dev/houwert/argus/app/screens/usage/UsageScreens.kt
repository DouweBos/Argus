package dev.houwert.argus.app.screens.usage

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.navigation.Router
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.usage.UsageMetric
import dev.houwert.argus.core.usage.UsageModelKey
import dev.houwert.argus.core.usage.UsageTab
import dev.houwert.argus.core.usage.default
import dev.houwert.argus.kit.protocol.generated.UsageRange
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.TitleBar
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.usage.HostUsageModelFilterView
import dev.houwert.argus.ui.usage.HostUsageModelView
import dev.houwert.argus.ui.usage.HostUsagePricesView
import dev.houwert.argus.ui.usage.HostUsageView
import dev.houwert.argus.ui.usage.LocalUsageNavigation
import dev.houwert.argus.ui.usage.UsageNavigation

/** Usage as a pushed screen; tab and range are screen state, and its rows push onto this stack. */
@Composable
fun UsageScreen() {
  val host = LocalAppStore.current.host
  val router = LocalRouter.current
  var tabRaw by rememberSaveable { mutableStateOf(UsageTab.Limits.rawValue) }
  var rangeRaw by rememberSaveable { mutableStateOf(UsageRange.default.rawValue) }
  val tab = UsageTab.fromRaw(tabRaw) ?: UsageTab.Limits
  val navigation = rememberUsageNavigation(host, router)
  Column(Modifier.fillMaxSize()) {
    TitleBar("Usage", onBack = router::pop) {
      if (tab != UsageTab.Limits) {
        IconBtn(Icon.filter, "Counted models", onClick = navigation.openCountedModels)
        IconBtn(Icon.price, "Model prices") { navigation.openPrices(null) }
      }
    }
    CompositionLocalProvider(LocalUsageNavigation provides navigation) {
      HostUsageView(host, tab, { tabRaw = it.rawValue }, UsageRange(rangeRaw), { rangeRaw = it.rawValue })
    }
  }
}

/** One model's detail under Cost or Tokens, over the range it was opened with. */
@Composable
fun UsageModelScreen(route: Route.UsageModel) {
  val host = LocalAppStore.current.host
  val router = LocalRouter.current
  val navigation = rememberUsageNavigation(host, router)
  Column(Modifier.fillMaxSize()) {
    TitleBar("Model usage", onBack = router::pop)
    CompositionLocalProvider(LocalUsageNavigation provides navigation) {
      HostUsageModelView(host, route.tab.metric ?: UsageMetric.Cost, UsageModelKey(route.runner, route.model), route.range)
    }
  }
}

/** The price editor: editing needs the control tier, and Save or Cancel goes back to where it was opened. */
@Composable
fun UsagePricesScreen() {
  val host = LocalAppStore.current.host
  val router = LocalRouter.current
  val capabilities by host.capabilities.collectAsState()
  Column(Modifier.fillMaxSize()) {
    TitleBar("Model prices", onBack = router::pop)
    HostUsagePricesView(host, canEdit = "control" in capabilities, onClose = router::pop)
  }
}

/** Which models Usage counts; editing needs the control tier. */
@Composable
fun UsageModelsScreen() {
  val host = LocalAppStore.current.host
  val router = LocalRouter.current
  val capabilities by host.capabilities.collectAsState()
  Column(Modifier.fillMaxSize()) {
    TitleBar("Counted models", onBack = router::pop)
    HostUsageModelFilterView(host, canEdit = "control" in capabilities)
  }
}

@Composable
private fun rememberUsageNavigation(host: HostStore, router: Router): UsageNavigation =
  remember(host, router) {
    UsageNavigation(
      openModel = { key, tab, range -> router.push(Route.UsageModel(tab, key.runner, key.model, range)) },
      openPrices = { model ->
        host.pendingPriceModel = model
        router.push(Route.UsagePrices)
      },
      openCountedModels = { router.push(Route.UsageModels) },
    )
  }
