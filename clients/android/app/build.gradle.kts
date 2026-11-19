plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.kotlin.android)
  alias(libs.plugins.kotlin.compose)
  alias(libs.plugins.kotlin.serialization)
}

android {
  namespace = "dev.houwert.argus.app"
  compileSdk = 36
  defaultConfig {
    applicationId = "dev.houwert.argus"
    minSdk = 29
    targetSdk = 36
    versionCode = 1
    versionName = "0.0.0"
  }
  buildTypes {
    debug { applicationIdSuffix = ".dev" }
    release {
      isMinifyEnabled = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  buildFeatures { compose = true }
  packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1,versions/9/OSGI-INF/MANIFEST.MF}" }
}

kotlin { jvmToolchain(17) }

dependencies {
  implementation(project(":ui"))
  implementation(libs.kotlinx.coroutines.android)
  implementation(libs.activity.compose)
  implementation(libs.lifecycle.runtime.compose)
  implementation(libs.lifecycle.viewmodel.compose)
  implementation(libs.lifecycle.process)
  implementation(libs.navigation.compose)
  implementation(libs.datastore.preferences)
  implementation(libs.camerax.camera2)
  implementation(libs.camerax.lifecycle)
  implementation(libs.camerax.view)
  implementation(libs.mlkit.barcode)
  testImplementation(libs.junit)
}
