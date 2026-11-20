package dev.houwert.argus.ui.composer

import dev.houwert.argus.kit.protocol.generated.RemoteSlashCommand

/** The slash-command menu: the agent's commands plus the built-ins the CLI hides in headless mode. */
object SlashCommandMenu {
  data class Command(val name: String, val description: String, val argumentHint: String) {
    val id: String get() = name

    constructor(command: RemoteSlashCommand) : this(command.name, command.description, command.argumentHint)
  }

  val builtins: List<Command> = listOf(
    Command("clear", "Clear conversation history", ""),
    Command("plan", "Enable plan mode or view the session plan", "[open|<description>]"),
    Command("model", "Switch the model for this session", "[model]"),
    Command("compact", "Summarize and clear conversation context", "[instructions]"),
    Command("help", "Show help and available commands", ""),
    Command("doctor", "Diagnose your Claude Code installation", ""),
    Command("status", "Show model, account, and tool status", ""),
    Command("fast", "Toggle fast mode", ""),
    Command("effort", "Set reasoning effort level", "[low|medium|high|xhigh|max|ultracode]"),
  )

  /** Never reaches the agent: opens the composer's limits panel. */
  val usageLimits = Command("usage-limits", "Show what's left of this agent's plan limits", "")

  /** Built-ins merged with the agent's own; the agent's entry wins when it describes itself. Alphabetical. */
  fun merged(commands: List<Command>, local: List<Command> = emptyList()): List<Command> {
    val byName = LinkedHashMap<String, Command>()
    for (command in builtins + local) byName[command.name] = command
    for (command in commands) {
      if (byName[command.name] == null || command.description.isNotEmpty()) byName[command.name] = command
    }
    return byName.values.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
  }

  /** Open only while the first token is still being typed. */
  fun suggestions(text: String, commands: List<Command>): List<Command> {
    if (!text.startsWith("/") || ' ' in text || '\n' in text) return emptyList()
    val needle = text.drop(1).lowercase()
    // Every match: the list scrolls, and a plugin can bring dozens.
    return commands.filter { needle.isEmpty() || needle in it.name.lowercase() }
  }

  fun accepted(command: Command): String = "/${command.name} "

  /** Ghost text after `/name ` until an argument is typed. */
  fun argumentHint(text: String, commands: List<Command>): String? {
    if (!text.startsWith("/")) return null
    val last = text.lastOrNull() ?: return null
    if (last != ' ' && last != '\t') return null
    val name = text.drop(1).dropLast(1)
    if (name.isEmpty() || name.any { it.isWhitespace() }) return null
    val hint = commands.firstOrNull { it.name.equals(name, ignoreCase = true) }?.argumentHint
    return hint?.takeIf { it.isNotEmpty() }
  }

  /** Commands the composer handles itself rather than sending to the CLI. */
  sealed interface Local {
    data object TogglePlan : Local
    data class SetModel(val model: String) : Local
    data object OpenModelPicker : Local
    data object ShowUsageLimits : Local
  }

  fun local(message: String): Local? {
    val trimmed = message.trim()
    if (!trimmed.startsWith("/")) return null
    val parts = trimmed.drop(1).split(Regex("\\s+")).filter { it.isNotEmpty() }
    val command = parts.firstOrNull()?.lowercase() ?: return null
    return when (command) {
      "plan" -> Local.TogglePlan
      usageLimits.name -> if (parts.size == 1) Local.ShowUsageLimits else null
      "model" -> {
        val argument = parts.drop(1).joinToString(" ")
        if (argument.isEmpty()) Local.OpenModelPicker else Local.SetModel(argument)
      }
      else -> null
    }
  }
}
