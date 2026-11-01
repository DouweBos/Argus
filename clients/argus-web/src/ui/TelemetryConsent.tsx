/**
 * The one-time telemetry question and its Settings row, in the phone's words
 * (`TelemetryConsentSheet.swift`). Only asked when the build has a PostHog
 * key; with none, nothing is ever sent.
 */

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  SettingsScreenField,
  Toggle,
} from "@argus/peacock";
import {
  hasAnsweredConsent,
  setTelemetryMode,
  telemetryConfigured,
  telemetryMode,
  type TelemetryMode,
} from "../telemetry/telemetry";

export function TelemetryConsent() {
  const [open, setOpen] = useState(
    () => telemetryConfigured() && !hasAnsweredConsent(),
  );
  if (!open) {
    return null;
  }
  const choose = (mode: TelemetryMode) => {
    setTelemetryMode(mode);
    setOpen(false);
  };

  return (
    <Dialog
      title="Help improve Argus"
      titleId="aw-telemetry-consent"
      // Closing without picking is "Just count me": the default, asked once.
      onClose={() => choose("presence")}
    >
      <DialogBody>
        <p className="aw-muted">
          Pick how much you want to share. You can change this any time under
          Settings → Privacy.
        </p>
        <p>
          <strong>Just count me</strong>
          <br />
          <span className="aw-muted">
            One event per visit — a random install id and the app version,
            nothing else. This is the minimum; Argus always sends this
            heartbeat.
          </span>
        </p>
        <p>
          <strong>Share anonymous data</strong>
          <br />
          <span className="aw-muted">
            Which screens you open and which actions you take, and how well the
            connection holds up.
          </span>
        </p>
        <p>
          <strong>What we never collect</strong>
          <br />
          <span className="aw-muted">
            Prompts, agent output, project names, branch names or repo paths.
            Your device name, or anything that identifies you or your
            computers.
          </span>
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => choose("presence")}>
          Just count me
        </Button>
        <Button variant="primary" onClick={() => choose("full")}>
          Share anonymous data
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/** Settings → Privacy. Hidden when the build has no key: there is no choice to make. */
export function PrivacyField() {
  const [full, setFull] = useState(() => telemetryMode() === "full");
  if (!telemetryConfigured()) {
    return null;
  }

  return (
    <SettingsScreenField
      label="Privacy"
      caption="Off, Argus sends one anonymous heartbeat per visit so we can count installs. On, it also sends which screens you open and which actions you take — never prompts, project names, branches or paths."
    >
      <Toggle
        checked={full}
        onChange={(on) => {
          setTelemetryMode(on ? "full" : "presence");
          setFull(on);
        }}
      >
        Share anonymous data
      </Toggle>
    </SettingsScreenField>
  );
}
