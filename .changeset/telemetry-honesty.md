---
"argus": patch
---

Corrected the telemetry documentation to be fully honest. When telemetry is opted in, Argus now clearly discloses every property attached to events — including the standard PostHog SDK auto-properties (browser, OS, screen, timezone, in-app URL, session id) and the city-level GeoIP that PostHog derives server-side from the request IP. Previous docs incorrectly claimed "anonymous distinct id only" and "no IP address or geolocation"; that is fixed. No code change to what's collected — only the docs.
