package dev.houwert.argus.kit.account

import kotlin.test.Test
import kotlin.test.assertEquals

/** The service's `/config`, as houwert.dev serves it once it knows Android. */
class AccountServiceConfigTest {
  @Test fun decodesMinClientWithAndroid() {
    val config = accountJson.decodeFromString(
      AccountServiceConfig.serializer(),
      """{"clerk_publishable_key":"pk","min_client":{"ios":"0","mac":"0","android":"0"},"later":1}""",
    )
    assertEquals("pk", config.clerkPublishableKey)
    assertEquals("0", config.minClient?.get("android"))
  }
}
