; Vendored from upstream tree-sitter queries, rewritten to the Argus capture vocabulary. See LICENSES.md.

; ---- alex-pinkus_tree-sitter-swift/queries/highlights.scm
[
  "."
  ";"
  ":"
  ","
] @punctuation

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation

; Identifiers
(type_identifier) @type

[
  (self_expression)
  (super_expression)
] @keyword

; Declarations
[
  "func"
  "deinit"
] @keyword

[
  (visibility_modifier)
  (member_modifier)
  (function_modifier)
  (property_modifier)
  (parameter_modifier)
  (inheritance_modifier)
  (mutation_modifier)
] @keyword

(simple_identifier) @variable

(function_declaration
  (simple_identifier) @function)

(protocol_function_declaration
  name: (simple_identifier) @function)

(init_declaration
  "init" @type)

(parameter
  external_name: (simple_identifier) @variable)

(parameter
  name: (simple_identifier) @variable)

(type_parameter
  (type_identifier) @variable)

(inheritance_constraint
  (identifier
    (simple_identifier) @variable))

(equality_constraint
  (identifier
    (simple_identifier) @variable))

[
  "protocol"
  "extension"
  "indirect"
  "nonisolated"
  "override"
  "convenience"
  "required"
  "some"
  "any"
  "weak"
  "unowned"
  "didSet"
  "willSet"
  "subscript"
  "let"
  "var"
  (throws)
  (where_keyword)
  (getter_specifier)
  (setter_specifier)
  (modify_specifier)
  (else)
  (as_operator)
] @keyword

[
  "enum"
  "struct"
  "class"
  "typealias"
] @keyword

[
  "async"
  "await"
] @keyword

(unsafe_expression
  "unsafe" @keyword)

(shebang_line) @keyword

(class_body
  (property_declaration
    (pattern
      (simple_identifier) @property)))

(protocol_property_declaration
  (pattern
    (simple_identifier) @property))

(navigation_expression
  (navigation_suffix
    (simple_identifier) @property))

(value_argument
  name: (value_argument_label
    (simple_identifier) @property))

(import_declaration
  "import" @keyword)

(enum_entry
  "case" @keyword)

(modifiers
  (attribute
    "@" @attribute
    (user_type
      (type_identifier) @attribute)))

; Function calls
(call_expression
  (simple_identifier) @function) ; foo()

(call_expression
  ; foo.bar.baz(): highlight the baz()
  (navigation_expression
    (navigation_suffix
      (simple_identifier) @function)))

(call_expression
  (prefix_expression
    (simple_identifier) @function)) ; .foo()

((navigation_expression
  (simple_identifier) @type) ; SomeType.method(): highlight SomeType as a type
  (#match? @type "^[A-Z]"))

(directive) @keyword

; See https://docs.swift.org/swift-book/documentation/the-swift-programming-language/lexicalstructure/#Keywords-and-Punctuation
[
  (diagnostic)
  (availability_condition)
  (playground_literal)
  (key_path_string_expression)
  (selector_expression)
  (external_macro_definition)
] @function

(special_literal) @constant

; Statements
(for_statement
  "for" @keyword)

(for_statement
  "in" @keyword)

[
  "while"
  "repeat"
  "continue"
  "break"
] @keyword

(guard_statement
  "guard" @keyword)

(if_statement
  "if" @keyword)

(switch_statement
  "switch" @keyword)

(switch_entry
  "case" @keyword)

(switch_entry
  "fallthrough" @keyword)

(switch_entry
  (default_keyword) @keyword)

"return" @keyword

(ternary_expression
  [
    "?"
    ":"
  ] @keyword)

[
  (try_operator)
  "do"
  (throw_keyword)
  (catch_keyword)
] @keyword

(statement_label) @constant

; Comments
[
  (comment)
  (multiline_comment)
] @comment 

((comment) @comment
  (#match? @comment "^///[^/]"))

((comment) @comment
  (#match? @comment "^///$"))

((multiline_comment) @comment
  (#match? @comment "^/[*][*][^*].*[*]/$"))

; String literals
(line_str_text) @string

(str_escaped_char) @escape

(multi_line_str_text) @string

(raw_str_part) @string

(raw_str_end_part) @string

(line_string_literal
  [
    "\\("
    ")"
  ] @punctuation)

(multi_line_string_literal
  [
    "\\("
    ")"
  ] @punctuation)

(raw_str_interpolation
  [
    (raw_str_interpolation_start)
    ")"
  ] @punctuation)

[
  "\""
  "\"\"\""
] @string

; Lambda literals
(lambda_literal
  "in" @keyword)

; Basic literals
[
  (integer_literal)
  (hex_literal)
  (oct_literal)
  (bin_literal)
] @number

(real_literal) @number

(boolean_literal) @constant

(nil_literal) @constant

(wildcard_pattern) @escape

; Regex literals
(regex_literal) @regex

; Operators
(custom_operator) @operator

[
  "+"
  "-"
  "*"
  "/"
  "%"
  "="
  "+="
  "-="
  "*="
  "/="
  "<"
  ">"
  "<<"
  ">>"
  "<="
  ">="
  "++"
  "--"
  "^"
  "&"
  "&&"
  "|"
  "||"
  "~"
  "%="
  "!="
  "!=="
  "=="
  "==="
  "?"
  "??"
  "->"
  "..<"
  "..."
  (bang)
] @operator

(type_arguments
  [
    "<"
    ">"
  ] @punctuation)
