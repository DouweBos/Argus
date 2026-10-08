import AppKit
import ArgusUI

/// Syntax colours for fenced code, by the fence's language. A handful of
/// lexical rules per family (comments, strings, numbers, keywords, types)
/// rather than a grammar: enough to read code at a glance, and cheap enough
/// for a chat full of it. Unknown or missing languages stay plain.
enum TranscriptSyntax {
  enum Token: CaseIterable {
    case comment, string, number, keyword, type, inserted, deleted, meta
  }

  /// Theme tokens, resolved per appearance at draw time.
  static func color(_ token: Token) -> NSColor {
    switch token {
    case .comment: TranscriptStyle.muted
    case .string: TranscriptStyle.syntaxString
    case .number: TranscriptStyle.syntaxNumber
    case .keyword: TranscriptStyle.syntaxKeyword
    case .type: TranscriptStyle.accent
    case .inserted: TranscriptStyle.syntaxString
    case .deleted: TranscriptStyle.error
    case .meta: TranscriptStyle.syntaxKeyword
    }
  }

  private struct Rule {
    let token: Token
    let regex: NSRegularExpression
  }

  /// Colours `string` in place; `language` is the fence's info string.
  static func highlight(_ string: NSMutableAttributedString, language: String?) {
    guard let rules = rules(for: language) else { return }
    let text = string.string as NSString
    let whole = NSRange(location: 0, length: text.length)
    // Earlier rules win: a keyword inside a string or comment stays a string.
    var taken = IndexSet()
    for rule in rules {
      rule.regex.enumerateMatches(in: string.string, range: whole) { match, _, _ in
        guard let match else { return }
        let range = match.numberOfRanges > 1 && match.range(at: 1).location != NSNotFound ? match.range(at: 1) : match.range
        guard range.length > 0, !taken.intersects(integersIn: range.location..<(range.location + range.length))
        else { return }
        taken.insert(integersIn: range.location..<(range.location + range.length))
        string.addAttribute(.foregroundColor, value: color(rule.token), range: range)
      }
    }
  }

  // MARK: Languages

  static func family(_ language: String?) -> String? {
    guard let raw = language?.split(whereSeparator: { $0 == " " || $0 == "{" || $0 == "," }).first?.lowercased(),
      !raw.isEmpty
    else { return nil }
    switch raw {
    case "swift": return "swift"
    case "ts", "typescript", "tsx", "js", "javascript", "jsx", "mjs", "cjs": return "ts"
    case "json", "jsonc", "json5": return "json"
    case "sh", "bash", "zsh", "shell", "console", "fish": return "sh"
    case "py", "python": return "py"
    case "go", "golang": return "go"
    case "rs", "rust": return "rust"
    case "kt", "kotlin", "java", "scala", "groovy", "gradle": return "kotlin"
    case "c", "h", "cpp", "c++", "cc", "hpp", "objc", "objective-c", "m", "mm", "cs", "csharp": return "c"
    case "rb", "ruby": return "ruby"
    case "yaml", "yml", "toml", "ini": return "yaml"
    case "css", "scss", "less": return "css"
    case "html", "xml", "svg", "plist", "vue": return "html"
    case "sql": return "sql"
    case "diff", "patch": return "diff"
    default: return nil
    }
  }

  nonisolated(unsafe) private static var compiled: [String: [Rule]] = [:]
  private static let lock = NSLock()

  private static func rules(for language: String?) -> [Rule]? {
    guard let family = family(language) else { return nil }
    lock.lock()
    defer { lock.unlock() }
    if let rules = compiled[family] { return rules }
    let rules = definitions(family).compactMap { token, pattern -> Rule? in
      (try? NSRegularExpression(pattern: pattern, options: [.anchorsMatchLines])).map { Rule(token: token, regex: $0) }
    }
    compiled[family] = rules
    return rules
  }

  private static func words(_ list: String) -> String {
    #"\b(?:"# + list.split(separator: " ").joined(separator: "|") + #")\b"#
  }

  private static let slashComments = #"//[^\n]*|/\*[\s\S]*?\*/"#
  private static let hashComments = #"(?:^|[ \t])(#[^\n]*)"#
  private static let quoted = #""(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'"#
  private static let number = #"\b(?:0x[0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b"#
  private static let capitalized = #"\b[A-Z][A-Za-z0-9_]*\b"#

  private static func definitions(_ family: String) -> [(Token, String)] {
    switch family {
    case "swift":
      return [
        (.comment, slashComments), (.string, #""""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*""#), (.meta, #"@\w+|#\w+"#),
        (.keyword, words("actor any as async await break case catch class continue default defer do else enum extension fallthrough false fileprivate final for func guard if import in init inout internal is let lazy mutating nil nonisolated open operator override private protocol public repeat rethrows return self Self some static struct subscript super switch throw throws true try typealias var weak where while")),
        (.type, capitalized), (.number, number),
      ]
    case "ts":
      return [
        (.comment, slashComments), (.string, quoted + #"|`(?:[^`\\]|\\.)*`"#),
        (.keyword, words("abstract as async await break case catch class const continue debugger declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface keyof let new null of private protected public readonly return set static super switch this throw true try type typeof undefined var void while yield")),
        (.type, capitalized), (.number, number),
      ]
    case "json":
      return [
        (.type, #"("(?:[^"\\\n]|\\.)*")\s*:"#), (.string, #""(?:[^"\\\n]|\\.)*""#),
        (.keyword, words("true false null")), (.number, #"-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b"#),
      ]
    case "sh":
      return [
        (.comment, hashComments), (.string, quoted), (.meta, #"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?"#),
        (.keyword, words("if then else elif fi for while until do done case esac in function return export local readonly set unset source alias sudo cd echo exit")),
        (.type, #"(?:^|[|;&]\s*)([a-zA-Z][\w.-]*)"#), (.number, #"(?<=\s)-{1,2}[A-Za-z][\w-]*"#),
      ]
    case "py":
      return [
        (.comment, hashComments), (.string, #"\"\"\"[\s\S]*?\"\"\"|'''[\s\S]*?'''|"# + quoted), (.meta, #"@\w+"#),
        (.keyword, words("and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield")),
        (.type, capitalized), (.number, number),
      ]
    case "go":
      return [
        (.comment, slashComments), (.string, quoted + #"|`[^`]*`"#),
        (.keyword, words("break case chan const continue default defer else fallthrough false for func go goto if import interface iota map nil package range return select struct switch true type var")),
        (.type, capitalized), (.number, number),
      ]
    case "rust":
      return [
        (.comment, slashComments), (.string, #""(?:[^"\\]|\\.)*""#), (.meta, #"#!?\[[^\]]*\]|\b\w+!"#),
        (.keyword, words("as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while")),
        (.type, capitalized), (.number, number),
      ]
    case "kotlin":
      return [
        (.comment, slashComments), (.string, quoted), (.meta, #"@\w+"#),
        (.keyword, words("abstract boolean break case catch char class companion const continue data default do double else enum extends false final finally float for fun if implements import in int interface is long new null object override package private protected public return sealed static super suspend switch this throw throws true try val var void when while")),
        (.type, capitalized), (.number, number),
      ]
    case "c":
      return [
        (.comment, slashComments), (.string, quoted), (.meta, #"^\s*#\s*\w+"#),
        (.keyword, words("auto bool break case catch char class const constexpr continue default delete do double else enum extern false float for goto if inline int long namespace new nullptr private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while self nil YES NO")),
        (.type, capitalized), (.number, number),
      ]
    case "ruby":
      return [
        (.comment, hashComments), (.string, quoted), (.meta, #":[A-Za-z_]\w*"#),
        (.keyword, words("begin break case class def do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true unless until when while yield require")),
        (.type, capitalized), (.number, number),
      ]
    case "yaml":
      return [
        (.comment, hashComments), (.type, #"^\s*-?\s*([\w.-]+)\s*[:=]"#), (.string, quoted),
        (.keyword, words("true false null yes no on off")), (.meta, #"^\s*\[[^\]]+\]"#), (.number, number),
      ]
    case "css":
      return [
        (.comment, #"/\*[\s\S]*?\*/"#), (.string, quoted), (.meta, #"@[\w-]+|--[\w-]+"#),
        (.type, #"([\w-]+)\s*:"#), (.number, #"#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms)?\b"#),
      ]
    case "html":
      return [
        (.comment, #"<!--[\s\S]*?-->"#), (.string, quoted), (.keyword, #"</?([A-Za-z][\w:-]*)"#),
        (.type, #"\s([A-Za-z_:][\w:.-]*)="#),
      ]
    case "sql":
      return [
        (.comment, #"--[^\n]*|/\*[\s\S]*?\*/"#), (.string, #"'(?:[^']|'')*'"#),
        (.keyword, "(?i)" + words("select from where and or not insert into values update set delete create table index drop alter join left right inner outer on group by order having limit offset as distinct null is in like primary key foreign references default union all case when then else end begin commit")),
        (.number, number),
      ]
    case "diff":
      return [
        (.meta, #"^(?:@@[^\n]*|diff [^\n]*|index [^\n]*|\+\+\+[^\n]*|---[^\n]*)"#), (.inserted, #"^\+[^\n]*"#),
        (.deleted, #"^-[^\n]*"#),
      ]
    default:
      return []
    }
  }
}
