---
"argus": patch
---

Telemetry docs now note that the PostHog project has "Discard client IP data" enabled — the raw IP is not stored alongside events, though PostHog still uses it at ingestion to derive city-level GeoIP fields before discarding it.
