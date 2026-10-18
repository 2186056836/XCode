import {
  DEFAULT_FEEDBACK_TICKET_FRAMEWORK,
  type XCodeProvider,
  type FeedbackTicketFramework,
} from "@zcode/shared";

export function inferFeedbackFrameworkFromAgentProvider(
  _provider: XCodeProvider | null | undefined,
): FeedbackTicketFramework {
  return DEFAULT_FEEDBACK_TICKET_FRAMEWORK;
}
