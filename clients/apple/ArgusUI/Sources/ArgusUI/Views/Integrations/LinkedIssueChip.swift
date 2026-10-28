import ArgusKit
import SwiftUI

/// The Linear issue a session was started from; opens it.
public struct LinkedIssueChip: View {
  let issue: RemoteLinkedIssue

  public init(issue: RemoteLinkedIssue) {
    self.issue = issue
  }

  public var body: some View {
    if let url = URL(string: issue.url) {
      Link(destination: url) {
        Chip(label: "\(issue.identifier) \(issue.title)", icon: Icon.issue)
      }
      .clickable()
      .help("Open \(issue.identifier) in Linear")
    } else {
      Chip(label: "\(issue.identifier) \(issue.title)", icon: Icon.issue)
    }
  }
}
