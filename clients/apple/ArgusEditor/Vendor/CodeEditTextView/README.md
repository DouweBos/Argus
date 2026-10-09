# CodeEditTextView 0.12.1 (vendored)

Copy of `Sources/` from https://github.com/CodeEditApp/CodeEditTextView at tag
`0.12.1` (`d7ac3f11f22ec2e820187acce8f3a3fb7aa8ddec`), MIT (see `LICENSE.md`).

Vendored rather than depended on because the upstream package runs a SwiftLint build-tool
plugin, which makes every `xcodebuild` of the Mac app fail plugin validation. To update,
replace both directories with the new tag's `Sources/` and bump the versions above.

Local patches, each marked `Argus patch` where it isn't a one-line fix (reapply on update):

- `TextLayoutManager+Layout.swift`: `layoutLine` shadowed its `inout maxFoundLineWidth`, so the
  widest line never reached `maxLineWidth` and the view never grew past the viewport (no
  horizontal scrolling with wrapping off).

- `TextView+ScrollToVisible.swift`: scrolling the caret into view keeps it clear of the leading
  inset, which the gutter floats over.
