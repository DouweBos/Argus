package dev.houwert.argus.core.devices

import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.Test

class EasBillingTest {
  @Test fun onlyAStoppedEasSlotIsABillableStart() {
    assertTrue(EasBilling.isBillableStart("eas:eh0123abcd:1", running = false))
    assertFalse(EasBilling.isBillableStart("eas:eh0123abcd:1", running = true))
    assertFalse(EasBilling.isBillableStart("A1B2-C3D4", running = false))
    assertEquals("eh0123abcd", EasBilling.hostId("eas:eh0123abcd:12"))
    assertNull(EasBilling.hostId("eas:eh0123abcd"))
  }

  @Test fun namesTheHostsLimitsWhenKnown() {
    assertTrue(EasBilling.startMessage(10, 30).contains("idle for 10 min, or it reaches its 30 min limit"))
    assertTrue(EasBilling.startMessage(null, null).contains("time limit"))
  }
}
