; Vendored from upstream tree-sitter queries, rewritten to the Argus capture vocabulary. See LICENSES.md.

; ---- tree-sitter_tree-sitter-json/queries/highlights.scm
(pair
  key: (_) @property)

(string) @string

(number) @number

[
  (null)
  (true)
  (false)
] @constant

(escape_sequence) @escape

(comment) @comment
