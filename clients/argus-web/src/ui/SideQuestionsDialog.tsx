/** Ask a running agent a quick question without adding anything to its chat. */

import { Dialog, DialogBody, SideQuestionPanel } from "@argus/peacock";
import { useSideQuestionsStore, type SideQuestionExchange } from "../stores/sideQuestions";
import { renderMarkdown } from "./transcript/TranscriptMessage";

const NO_EXCHANGES: SideQuestionExchange[] = [];

export function SideQuestionsDialog({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}) {
  const exchanges = useSideQuestionsStore(
    (s) => s.exchangesByAgent[agentId] ?? NO_EXCHANGES,
  );
  const ask = useSideQuestionsStore((s) => s.ask);
  const sendToAgent = useSideQuestionsStore((s) => s.sendToAgent);
  const clear = useSideQuestionsStore((s) => s.clear);

  return (
    <Dialog
      size="medium"
      title="Side questions"
      titleId="aw-side-questions"
      onClose={onClose}
    >
      <DialogBody>
        <SideQuestionPanel
          items={exchanges}
          renderMarkdown={renderMarkdown}
          onAsk={(question) => {
            void ask(agentId, question);
          }}
          onClear={() => clear(agentId)}
          onSend={(id) => {
            sendToAgent(agentId, id).catch(() => {});
          }}
        />
      </DialogBody>
    </Dialog>
  );
}
