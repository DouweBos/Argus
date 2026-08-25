/**
 * ExitPlanMode approval — renders the proposed plan with Approve / Keep
 * planning actions and a feedback box that refines the plan (sent back as a
 * deny message), matching the desktop flow.
 */

import { useState } from "react";
import { View } from "react-native";
import { Markdown } from "./Markdown";
import { Btn, Muted, Row, TextField } from "./ui";
import { useTheme } from "../theme";

export function PlanApproval({
  plan,
  onApprove,
  onReject,
  onSubmitFeedback,
}: {
  plan: string;
  onApprove: () => void;
  onReject: () => void;
  onSubmitFeedback: (feedback: string) => void;
}) {
  const theme = useTheme();
  const [feedback, setFeedback] = useState("");

  const send = () => {
    const trimmed = feedback.trim();
    if (!trimmed) {
      return;
    }
    setFeedback("");
    onSubmitFeedback(trimmed);
  };

  return (
    <View style={{ gap: 10 }}>
      <Muted>Proposed plan</Muted>
      <View
        style={{
          backgroundColor: theme.bgTertiary,
          borderRadius: theme.radiusSm,
          borderWidth: 1,
          borderColor: theme.borderSubtle,
          padding: 10,
        }}
      >
        <Markdown text={plan} />
      </View>
      <TextField
        multiline
        value={feedback}
        placeholder="Feedback to refine the plan…"
        onChangeText={setFeedback}
      />
      <Row>
        <Btn label="Approve" size="sm" onPress={onApprove} />
        {feedback.trim() ? (
          <Btn label="Send feedback" size="sm" tone="secondary" onPress={send} />
        ) : (
          <Btn label="Keep planning" size="sm" tone="ghost" onPress={onReject} />
        )}
      </Row>
    </View>
  );
}
