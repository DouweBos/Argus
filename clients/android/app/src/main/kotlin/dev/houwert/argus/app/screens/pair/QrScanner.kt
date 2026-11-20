package dev.houwert.argus.app.screens.pair

import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageProxy
import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

/** A camera preview that reports the first QR code it reads; asks for the camera first. */
@Composable
fun QrScanner(onCode: (String) -> Unit, modifier: Modifier = Modifier) {
  val context = LocalContext.current
  var granted by remember {
    mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
  }
  val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
  if (!granted) {
    Box(modifier, contentAlignment = Alignment.Center) { Button(onClick = { ask.launch(Manifest.permission.CAMERA) }) { Text("Scan a QR code") } }
    return
  }
  val lifecycle = LocalLifecycleOwner.current
  val executor = remember { Executors.newSingleThreadExecutor() }
  val scanner = remember { BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()) }
  var reported by remember { mutableStateOf(false) }
  DisposableEffect(Unit) {
    onDispose {
      scanner.close()
      executor.shutdown()
      runCatching { ProcessCameraProvider.getInstance(context).get().unbindAll() }
    }
  }
  AndroidView(
    modifier = modifier,
    factory = { ctx ->
      val view = PreviewView(ctx)
      val providerFuture = ProcessCameraProvider.getInstance(ctx)
      providerFuture.addListener({
        val provider = providerFuture.get()
        val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
        val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
        analysis.setAnalyzer(executor) { proxy ->
          val media = proxy.mediaImage()
          if (media == null || reported) return@setAnalyzer proxy.close()
          scanner.process(InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees))
            .addOnSuccessListener { codes ->
              val value = codes.firstNotNullOfOrNull { it.rawValue }
              if (value != null && !reported) {
                reported = true
                onCode(value)
              }
            }
            .addOnCompleteListener { proxy.close() }
        }
        provider.unbindAll()
        provider.bindToLifecycle(lifecycle, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
      }, ContextCompat.getMainExecutor(ctx))
      view
    },
  )
}

/** CameraX marks the raw image experimental; ML Kit needs it to read the frame. */
@androidx.annotation.OptIn(markerClass = [ExperimentalGetImage::class])
private fun ImageProxy.mediaImage() = image
