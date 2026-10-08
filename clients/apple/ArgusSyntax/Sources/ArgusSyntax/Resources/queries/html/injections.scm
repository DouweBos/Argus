; Argus injections for HTML: <script> as JavaScript, <style> as CSS.
((script_element
  (raw_text) @injection.content)
  (#set! injection.language "javascript"))

((style_element
  (raw_text) @injection.content)
  (#set! injection.language "css"))
