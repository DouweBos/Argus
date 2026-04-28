---
"argus": patch
---

Session and chat titles now generate reliably instead of falling back to a slug, by giving the underlying `claude -p` call enough time to warm up before timing out.
