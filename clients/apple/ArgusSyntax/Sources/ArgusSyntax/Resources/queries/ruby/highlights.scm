; Vendored from upstream tree-sitter queries, rewritten to the Argus capture vocabulary. See LICENSES.md.

; ---- tree-sitter_tree-sitter-ruby/queries/highlights.scm
(identifier) @variable

((identifier) @function
 (#is-not? local))

[
  "alias"
  "and"
  "begin"
  "break"
  "case"
  "class"
  "def"
  "do"
  "else"
  "elsif"
  "end"
  "ensure"
  "for"
  "if"
  "in"
  "module"
  "next"
  "or"
  "rescue"
  "retry"
  "return"
  "then"
  "unless"
  "until"
  "when"
  "while"
  "yield"
] @keyword

((identifier) @keyword
 (#match? @keyword "^(private|protected|public)$"))

(constant) @type

; Function calls

"defined?" @function

(call
  method: [(identifier) (constant)] @function)

((identifier) @function
 (#eq? @function "require"))

; Function definitions

(alias (identifier) @function)
(setter (identifier) @function)
(method name: [(identifier) (constant)] @function)
(singleton_method name: [(identifier) (constant)] @function)

; Identifiers

[
  (class_variable)
  (instance_variable)
] @property

((identifier) @constant
 (#match? @constant "^__(FILE|LINE|ENCODING)__$"))

(file) @constant
(line) @constant
(encoding) @constant

(hash_splat_nil
  "**" @operator) @constant

((constant) @constant
 (#match? @constant "^[A-Z\\d_]+$"))

[
  (self)
  (super)
] @keyword

(block_parameter (identifier) @variable)
(block_parameters (identifier) @variable)
(destructured_parameter (identifier) @variable)
(hash_splat_parameter (identifier) @variable)
(lambda_parameters (identifier) @variable)
(method_parameters (identifier) @variable)
(splat_parameter (identifier) @variable)

(keyword_parameter name: (identifier) @variable)
(optional_parameter name: (identifier) @variable)

; Literals

[
  (string)
  (bare_string)
  (subshell)
  (heredoc_body)
  (heredoc_beginning)
] @string

[
  (simple_symbol)
  (delimited_symbol)
  (hash_key_symbol)
  (bare_symbol)
] @constant

(regex) @regex
(escape_sequence) @escape

[
  (integer)
  (float)
] @number

[
  (nil)
  (true)
  (false)
] @constant

(interpolation
  "#{" @punctuation
  "}" @punctuation) 

(comment) @comment

; Operators

[
"="
"=>"
"->"
] @operator

[
  ","
  ";"
  "."
] @punctuation

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
  "%w("
  "%i("
] @punctuation
