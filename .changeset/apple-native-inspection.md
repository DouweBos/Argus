---
"argus": minor
"@argus/peacock": minor
---

Device UI inspection is now Apple-only and reads the running app in-process for
much richer detail — real class names, resolved colors and fonts, text, and the
full view/layer tree — instead of the accessibility-only snapshot. The Inspect
mode only appears for iOS/iPadOS/tvOS runtimes. If the app isn't set up for
inspection, Inspect now offers one click to restart the running app with it
enabled, or — on the home screen — a picker to launch any installed app with
inspection. Selecting an element lets you live-edit its text, colors, alpha,
visibility, corner radius, and border right on the device. Adds a ColorSwatch
component to the design system.
