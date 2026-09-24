---
"argus": patch
---

CLI diagnostics like an unrecognized model id now read as warnings in the transcript, with their details spelled out instead of dumped as raw JSON. They were styled as errors, which made a harmless notice look like the run had failed.
