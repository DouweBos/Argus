#!/bin/bash
# Regenerates Sources/ArgusSyntax/Resources/queries from the pinned upstream grammars.
# Usage: Scripts/vendor-queries.sh   (clones into a temp dir; versions match Package.swift)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
G=$(mktemp -d)
Q="$HERE/../Sources/ArgusSyntax/Resources/queries"
R="$HERE/rewrite-captures.pl"
clone() { git -c advice.detachedHead=false clone -q --depth 1 --branch "$2" "https://github.com/$1.git" "$G/$(echo "$1" | tr / _)"; }
clone alex-pinkus/tree-sitter-swift 0.7.4-with-generated-files
clone tree-sitter/tree-sitter-typescript v0.23.2
clone tree-sitter/tree-sitter-javascript v0.25.0
clone tree-sitter/tree-sitter-json v0.24.8
clone tree-sitter-grammars/tree-sitter-markdown v0.5.3
clone fwcd/tree-sitter-kotlin 0.3.8
clone tree-sitter/tree-sitter-java v0.23.5
clone tree-sitter-grammars/tree-sitter-objc v3.0.2
clone tree-sitter/tree-sitter-c v0.24.2
clone tree-sitter-grammars/tree-sitter-yaml v0.7.2
clone tree-sitter/tree-sitter-bash v0.25.1
clone tree-sitter/tree-sitter-css v0.25.0
clone tree-sitter/tree-sitter-html v0.23.2
clone tree-sitter/tree-sitter-python v0.25.0
clone tree-sitter/tree-sitter-ruby v0.23.1
clone tree-sitter/tree-sitter-go v0.25.0
clone tree-sitter/tree-sitter-rust v0.24.2
find "$Q" -name "*.scm" -delete
emit() { # name, src files...
  local name=$1; shift
  mkdir -p "$Q/$name"
  {
    echo "; Vendored from upstream tree-sitter queries, rewritten to the Argus capture vocabulary. See LICENSES.md."
    for f in "$@"; do echo; echo "; ---- ${f#$G/}"; perl "$R" "$f"; done
  } > "$Q/$name/highlights.scm"
}
JS=$G/tree-sitter_tree-sitter-javascript/queries
emit swift $G/alex-pinkus_tree-sitter-swift/queries/highlights.scm
emit javascript $JS/highlights.scm $JS/highlights-jsx.scm
emit typescript $JS/highlights.scm $G/tree-sitter_tree-sitter-typescript/queries/highlights.scm
emit tsx $JS/highlights.scm $JS/highlights-jsx.scm $G/tree-sitter_tree-sitter-typescript/queries/highlights.scm
emit json $G/tree-sitter_tree-sitter-json/queries/highlights.scm
emit markdown $G/tree-sitter-grammars_tree-sitter-markdown/tree-sitter-markdown/queries/highlights.scm
emit markdown_inline $G/tree-sitter-grammars_tree-sitter-markdown/tree-sitter-markdown-inline/queries/highlights.scm
emit kotlin $G/fwcd_tree-sitter-kotlin/queries/highlights.scm
emit java $G/tree-sitter_tree-sitter-java/queries/highlights.scm
emit objc $G/tree-sitter_tree-sitter-c/queries/highlights.scm $G/tree-sitter-grammars_tree-sitter-objc/queries/highlights.scm
emit yaml $G/tree-sitter-grammars_tree-sitter-yaml/queries/highlights.scm
emit bash $G/tree-sitter_tree-sitter-bash/queries/highlights.scm
emit css $G/tree-sitter_tree-sitter-css/queries/highlights.scm
emit html $G/tree-sitter_tree-sitter-html/queries/highlights.scm
emit python $G/tree-sitter_tree-sitter-python/queries/highlights.scm
emit ruby $G/tree-sitter_tree-sitter-ruby/queries/highlights.scm
emit go $G/tree-sitter_tree-sitter-go/queries/highlights.scm
emit rust $G/tree-sitter_tree-sitter-rust/queries/highlights.scm
# Upstream quirks, fixed so the colours read right.
perl -pi -e 's/^\((integer_literal|float_literal)\) \@constant/($1) \@number/' "$Q/rust/highlights.scm"
for f in javascript typescript tsx; do perl -pi -e 's/^\(regex\) \@string$/(regex) \@regex/' "$Q/$f/highlights.scm"; done
perl -0pi -e 's/\(package_header\n\t\. \(identifier\)\) \@type/(package_header\n\t(identifier) \@type)/' "$Q/kotlin/highlights.scm"
# Go is written first-match-wins; Argus paints last-match-wins, so its catch-alls move to the top.
perl -0pi -e 's/\(type_identifier\) \@type\n\(field_identifier\) \@property\n\(identifier\) \@variable\n//; s/(; ---- [^\n]*\n)/$1(type_identifier) \@type\n(field_identifier) \@property\n(identifier) \@variable\n/' "$Q/go/highlights.scm"
# nvim-only predicate: drop the pattern rather than ship #has-ancestor?
perl -0pi -e 's/\(\(identifier\) \@property\s*\(#has-ancestor\? \@property struct_declaration\)\)\n//' "$Q/objc/highlights.scm"
cat > "$Q/markdown/injections.scm" <<'EOS'
; Argus injections for Markdown: fenced code by info string, inline syntax, raw HTML.
(fenced_code_block
  (info_string
    (language) @injection.language)
  (code_fence_content) @injection.content)

((html_block) @injection.content
  (#set! injection.language "html"))

((inline) @injection.content
  (#set! injection.language "markdown_inline"))
EOS
cat > "$Q/html/injections.scm" <<'EOS'
; Argus injections for HTML: <script> as JavaScript, <style> as CSS.
((script_element
  (raw_text) @injection.content)
  (#set! injection.language "javascript"))

((style_element
  (raw_text) @injection.content)
  (#set! injection.language "css"))
EOS
grep -rn "has-ancestor\|lua-match\|not-kind-eq\|offset!\|strip!\|select-adjacent" "$Q" || true
rm -rf "$G"
