package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.LinearIssue
import dev.houwert.argus.kit.protocol.generated.LinearIssueCycle
import dev.houwert.argus.kit.protocol.generated.LinearWorkflowState

/** A Linear issue with only what a test cares about filled in. */
internal fun linearIssue(
  id: String,
  type: String = "unstarted",
  state: String? = null,
  position: Double = 0.0,
  priority: Double = 0.0,
  title: String = "t",
  labels: List<String> = emptyList(),
  cycle: LinearIssueCycle? = null,
  createdAt: Double = 0.0,
  updatedAt: Double = 0.0,
  branchName: String = "${id.lowercase()}-fix",
): LinearIssue = LinearIssue(
  id = id, identifier = id, title = title, description = "", url = "https://linear.app/x/$id", branchName = branchName,
  state = LinearWorkflowState("$id-state", state ?: type, type, position), priority = priority,
  teamId = "t", teamKey = "ENG", teamName = "Engineering", labels = labels, cycle = cycle,
  pullRequestCount = 0.0, createdAt = createdAt, updatedAt = updatedAt,
)
