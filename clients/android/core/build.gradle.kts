plugins {
  alias(libs.plugins.kotlin.jvm)
  alias(libs.plugins.kotlin.serialization)
}

kotlin { jvmToolchain(17) }

dependencies {
  api(project(":kit"))
  testImplementation(libs.kotlin.test)
  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)
}
