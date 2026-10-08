; Vendored from upstream tree-sitter queries, rewritten to the Argus capture vocabulary. See LICENSES.md.

; ---- tree-sitter-grammars_tree-sitter-markdown/tree-sitter-markdown-inline/queries/highlights.scm
; From nvim-treesitter/nvim-treesitter
[
  (code_span)
  (link_title)
] @code

[
  (emphasis_delimiter)
  (code_span_delimiter)
] @punctuation

(emphasis) @emphasis

(strong_emphasis) @strong

[
  (link_destination)
  (uri_autolink)
] @link

[
  (link_label)
  (link_text)
  (image_description)
] @link

[
  (backslash_escape)
  (hard_line_break)
] @escape

(image
  [
    "!"
    "["
    "]"
    "("
    ")"
  ] @punctuation)

(inline_link
  [
    "["
    "]"
    "("
    ")"
  ] @punctuation)

(shortcut_link
  [
    "["
    "]"
  ] @punctuation)

; NOTE: extension not enabled by default
; (wiki_link ["[" "|" "]"] @punctuation.delimiter)
