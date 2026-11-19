package dev.houwert.argus.core.hosts

/** Which machine a host-owned id belongs to: a paired host is keyed by the device id it issued us. */
typealias HostId = String

object Hosts {
  /** The Mac's own host; never issued as a device id (those are uuids), so it can't collide. */
  const val LOCAL: HostId = "local"
}
