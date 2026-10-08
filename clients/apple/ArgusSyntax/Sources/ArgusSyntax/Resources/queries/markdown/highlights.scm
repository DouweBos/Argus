; Vendored from upstream tree-sitter queries, rewritten to the Argus capture vocabulary. See LICENSES.md.

; ---- tree-sitter-grammars_tree-sitter-markdown/tree-sitter-markdown/queries/highlights.scm
;From nvim-treesitter/nvim-treesitter
(atx_heading
  (inline) @heading)

(setext_heading
  (paragraph) @heading)

[
  (atx_h1_marker)
  (atx_h2_marker)
  (atx_h3_marker)
  (atx_h4_marker)
  (atx_h5_marker)
  (atx_h6_marker)
  (setext_h1_underline)
  (setext_h2_underline)
] @punctuation

[
  (link_title)
  (indented_code_block)
  (fenced_code_block)
] @code

(fenced_code_block_delimiter) @punctuation

(code_fence_content) @none

(link_destination) @link

(link_label) @link

[
  (list_marker_plus)
  (list_marker_minus)
  (list_marker_star)
  (list_marker_dot)
  (list_marker_parenthesis)
  (thematic_break)
] @punctuation

[
  (block_continuation)
  (block_quote_marker)
] @punctuation

(backslash_escape) @escape
