plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.kotlin.android)
  alias(libs.plugins.kotlin.compose)
  alias(libs.plugins.kotlin.serialization)
}

// Push needs the Firebase project's config; without it the app builds with push off.
val hasFirebaseConfig = file("google-services.json").exists()
if (hasFirebaseConfig) apply(plugin = libs.plugins.google.services.get().pluginId)

// One version across Mac, iPhone and Android: package.json's, without a pre-release suffix.
val packageVersion: String = providers.fileContents(rootProject.layout.projectDirectory.file("../../package.json")).asText
  .map { Regex("\"version\"\\s*:\\s*\"([^\"]+)\"").find(it)?.groupValues?.get(1) ?: "0.0.0" }
  .get()
  .substringBefore('-')
// The release workflow passes run number + 2000, the same build number as the Apple apps.
val buildNumber: Int = providers.environmentVariable("ARGUS_BUILD_NUMBER").orNull?.toIntOrNull() ?: 1
val releaseKeystore: String? = providers.environmentVariable("ARGUS_ANDROID_KEYSTORE").orNull
fun posthogSetting(name: String): String =
  providers.environmentVariable(name).orElse(providers.gradleProperty(name)).orNull.orEmpty()

android {
  namespace = "dev.houwert.argus.app"
  compileSdk = 36
  defaultConfig {
    applicationId = "dev.houwert.argus"
    minSdk = 29
    targetSdk = 36
    versionCode = buildNumber
    versionName = packageVersion
    buildConfigField("boolean", "PUSH_CONFIGURED", hasFirebaseConfig.toString())
    // Telemetry is off entirely without a key, which is what a plain checkout builds.
    buildConfigField("String", "POSTHOG_KEY", "\"${posthogSetting("POSTHOG_KEY")}\"")
    buildConfigField("String", "POSTHOG_HOST", "\"${posthogSetting("POSTHOG_HOST").ifEmpty { "https://eu.i.posthog.com" }}\"")
  }
  signingConfigs {
    if (releaseKeystore != null) {
      create("release") {
        storeFile = file(releaseKeystore)
        storePassword = providers.environmentVariable("ARGUS_ANDROID_KEYSTORE_PASSWORD").orNull
        keyAlias = providers.environmentVariable("ARGUS_ANDROID_KEY_ALIAS").orNull
        keyPassword = providers.environmentVariable("ARGUS_ANDROID_KEY_PASSWORD").orNull
      }
    }
  }
  buildTypes {
    debug { applicationIdSuffix = ".dev" }
    release {
      signingConfigs.findByName("release")?.let { signingConfig = it }
      isMinifyEnabled = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  buildFeatures {
    compose = true
    buildConfig = true
  }
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
  implementation(libs.kotlinx.serialization.json)
  implementation(platform(libs.firebase.bom))
  implementation(libs.firebase.messaging)
  implementation(libs.glance.appwidget)
  implementation(libs.biometric)
  implementation(libs.work.runtime)
  implementation(libs.posthog.android)
  implementation(libs.okhttp)
  testImplementation(libs.junit)
}
