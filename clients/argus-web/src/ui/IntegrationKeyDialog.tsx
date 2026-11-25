/** Connect Linear or Figma with a personal key, sent to the computer's secret store. */

import { useState } from "react";
import type { IntegrationId } from "@argus/remote-protocol";
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  FormField,
  Input,
} from "@argus/peacock";
import { describeError } from "@argus/client-core";
import { useIntegrationsStore } from "../stores/integrations";
import { capture } from "../telemetry/telemetry";

const HELP: Record<IntegrationId, string> = {
  linear:
    "Create a personal API key in Linear under Settings → Account → Security & access.",
  figma:
    "Create a personal access token in Figma under Settings → Security.",
};

export function IntegrationKeyDialog({
  id,
  name,
  onClose,
}: {
  id: IntegrationId;
  name: string;
  onClose: () => void;
}) {
  const connect = useIntegrationsStore((s) => s.connectIntegration);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !key.trim()) {
      return;
    }
    setBusy(true);
    try {
      await connect(id, key);
      capture("web_integration_changed", {
        provider: id,
        action: "connect",
        success: true,
      });
      onClose();
    } catch (err) {
      setError(describeError(err));
      capture("web_integration_changed", {
        provider: id,
        action: "connect",
        success: false,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Connect ${name}`}
      titleId="aw-integration-key"
      onClose={onClose}
    >
      <DialogBody>
        <FormField
          error={error ?? undefined}
          helper={`${HELP[id]} It's checked with ${name}, then kept in the computer's secret store and never sent back to this browser.`}
          htmlFor="aw-integration-key-input"
          label="API key"
        >
          <Input
            autoComplete="off"
            id="aw-integration-key-input"
            mono
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void submit();
              }
            }}
          />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy || !key.trim()} onClick={() => void submit()}>
          {busy ? "Connecting" : "Connect"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
