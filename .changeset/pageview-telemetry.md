---
"argus": minor
---

Track navigation as `$pageview` events when telemetry is enabled, so PostHog Web Analytics and DAU insights work. URLs are sanitised first — every dynamic segment (session, organisation, PR identifiers) is replaced with a placeholder before the event leaves your machine.
