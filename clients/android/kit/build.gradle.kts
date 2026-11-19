plugins {
  alias(libs.plugins.kotlin.jvm)
  alias(libs.plugins.kotlin.serialization)
}

kotlin { jvmToolchain(17) }

dependencies {
  api(libs.kotlinx.coroutines.core)
  api(libs.kotlinx.serialization.json)
  implementation(libs.okhttp)
  implementation(libs.bouncycastle)
  testImplementation(libs.kotlin.test)
  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)
  testImplementation(libs.okhttp.mockwebserver)
}

// The account log's golden fixtures, shared with the TS and Swift verifiers.
sourceSets["test"].resources.srcDir("../../../packages/remote-protocol/src/account/fixtures")
