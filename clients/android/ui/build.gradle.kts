plugins {
  alias(libs.plugins.android.library)
  alias(libs.plugins.kotlin.android)
  alias(libs.plugins.kotlin.compose)
}

android {
  namespace = "dev.houwert.argus.ui"
  compileSdk = 36
  defaultConfig { minSdk = 29 }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  buildFeatures { compose = true }
}

kotlin { jvmToolchain(17) }

dependencies {
  api(project(":core"))
  api(platform(libs.compose.bom))
  api(libs.compose.ui)
  api(libs.compose.foundation)
  api(libs.compose.material3)
  api(libs.compose.material.icons)
  api(libs.compose.ui.tooling.preview)
  api(libs.lifecycle.runtime.compose)
  implementation(libs.activity.compose)
  implementation(libs.lifecycle.process)
  implementation(libs.coil.compose)
  implementation(libs.coil.network.okhttp)
  implementation(libs.okhttp)
  debugImplementation(libs.compose.ui.tooling)
  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)
}
