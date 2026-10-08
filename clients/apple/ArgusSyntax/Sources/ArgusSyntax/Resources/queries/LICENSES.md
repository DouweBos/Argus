# Query licences

The `highlights.scm` files here are vendored from each grammar's upstream repository and
rewritten to the Argus capture vocabulary by `Scripts/vendor-queries.sh`. The
`injections.scm` files are Argus's own. All upstream queries are MIT licensed; Kotlin's and
Markdown's are themselves derived from nvim-treesitter (Apache-2.0).

| Directory | Upstream | Version | Licence |
|---|---|---|---|
| `swift` | alex-pinkus/tree-sitter-swift | 0.7.4 | MIT, © 2021 alex-pinkus |
| `javascript`, `typescript`, `tsx` | tree-sitter/tree-sitter-javascript, tree-sitter/tree-sitter-typescript | 0.25.0, 0.23.2 | MIT, © 2014/2017 Max Brunsfeld |
| `json` | tree-sitter/tree-sitter-json | 0.24.8 | MIT, © 2014 Max Brunsfeld |
| `markdown`, `markdown_inline` | tree-sitter-grammars/tree-sitter-markdown | 0.5.3 | MIT, © 2021 Matthias Deiml |
| `kotlin` | fwcd/tree-sitter-kotlin | 0.3.8 | MIT, © 2019 fwcd |
| `java` | tree-sitter/tree-sitter-java | 0.23.5 | MIT, © 2017 Ayman Nadeem |
| `objc` | tree-sitter/tree-sitter-c, tree-sitter-grammars/tree-sitter-objc | 0.24.2, 3.0.2 | MIT, © 2014 Max Brunsfeld, © 2023 Amaan Qureshi |
| `yaml` | tree-sitter-grammars/tree-sitter-yaml | 0.7.2 | MIT, © 2019-2021 Ika, © 2024 tree-sitter-grammars contributors |
| `bash` | tree-sitter/tree-sitter-bash | 0.25.1 | MIT, © 2017 Max Brunsfeld |
| `css` | tree-sitter/tree-sitter-css | 0.25.0 | MIT, © 2018 Max Brunsfeld |
| `html` | tree-sitter/tree-sitter-html | 0.23.2 | MIT, © 2014 Max Brunsfeld |
| `python` | tree-sitter/tree-sitter-python | 0.25.0 | MIT, © 2016 Max Brunsfeld |
| `ruby` | tree-sitter/tree-sitter-ruby | 0.23.1 | MIT, © 2016 Rob Rix |
| `go` | tree-sitter/tree-sitter-go | 0.25.0 | MIT, © 2014 Max Brunsfeld |
| `rust` | tree-sitter/tree-sitter-rust | 0.24.2 | MIT, © 2017 Maxim Sokolov |

The generated parsers in `Vendor/` (CSS, JavaScript, Python, YAML) carry their upstream
`LICENSE` files alongside.
