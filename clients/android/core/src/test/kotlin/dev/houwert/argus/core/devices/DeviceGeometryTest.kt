package dev.houwert.argus.core.devices

import kotlin.test.assertEquals
import kotlin.test.assertNull
import org.junit.Test

class DeviceGeometryTest {
  @Test fun letterboxesAPortraitStreamAndMapsPointsInsideIt() {
    val geometry = DeviceGeometry(DSize(100.0, 200.0), DSize(400.0, 200.0))
    assertEquals(DRect(150.0, 0.0, 100.0, 200.0), geometry.pictureRect)
    assertEquals(DPoint(0.5, 0.5), geometry.normalize(DPoint(200.0, 100.0)))
    // Outside the picture clamps to its edge.
    assertEquals(DPoint(0.0, 0.0), geometry.normalize(DPoint(0.0, 0.0)))
  }

  @Test fun aQuarterTurnSwapsTheAxesAndMapsBackIntoPanelCoordinates() {
    val geometry = DeviceGeometry(DSize(100.0, 200.0), DSize(400.0, 200.0), rotation = 90.0)
    assertEquals(DSize(200.0, 100.0), geometry.shown)
    assertEquals(DSize(200.0, 400.0), geometry.renderedSize)
    // The top-left of what we drew is the panel's bottom-left.
    assertEquals(DPoint(0.0, 1.0), geometry.normalize(DPoint(0.0, 0.0)))
  }

  @Test fun uprightMappingIgnoresRotationAndRoundTripsARect() {
    val geometry = DeviceGeometry(DSize(100.0, 200.0), DSize(400.0, 400.0), rotation = 90.0)
    assertEquals(DPoint(0.25, 0.25), geometry.uprightNormalize(DPoint(100.0, 150.0)))
    assertNull(geometry.uprightNormalize(DPoint(100.0, 50.0)))
    assertEquals(DRect(200.0, 200.0, 200.0, 100.0), geometry.uprightRect(DRect(0.5, 0.5, 0.5, 0.5)))
  }

  @Test fun nothingMapsBeforeTheStreamsSizeIsKnown() {
    val geometry = DeviceGeometry(DSize.Zero, DSize(10.0, 10.0))
    assertNull(geometry.normalize(DPoint(0.0, 0.0)))
    assertEquals(DSize(10.0, 10.0), geometry.renderedSize)
  }
}
