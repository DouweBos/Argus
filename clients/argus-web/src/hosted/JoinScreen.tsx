import { Banner, Button, Card, Spinner } from "@argus/peacock";
import { useAccountStore } from "../account/accountStore";

function Pending({ label }: { label: string }) {
  return (
    <div className="aw-inline">
      <Spinner size="sm" />
      <span className="aw-muted">{label}</span>
    </div>
  );
}

/**
 * Waiting for a device already on the account to let this browser in, then
 * the 6-digit comparison that makes the approval safe.
 */
export function JoinScreen() {
  const join = useAccountStore((s) => s.join);
  const name = useAccountStore((s) => s.name);
  const confirmCode = useAccountStore((s) => s.confirmCode);
  const rejectCode = useAccountStore((s) => s.rejectCode);
  const confirmApproved = useAccountStore((s) => s.confirmApproved);
  const rejectApproved = useAccountStore((s) => s.rejectApproved);
  const retryJoin = useAccountStore((s) => s.retryJoin);
  const signOut = useAccountStore((s) => s.signOut);

  const signOutButton = (
    <Button variant="ghost" onClick={() => void signOut()}>
      Sign out
    </Button>
  );

  switch (join.kind) {
    case "compare":
      return (
        <Card size="sm" stack>
          <p className="aw-muted">
            Does {join.approverName} show this code? Only confirm if it matches
            exactly.
          </p>
          <div className="aw-sas">{join.sas}</div>
          <div className="aw-inline">
            <Button variant="primary" onClick={() => void confirmCode()}>
              Codes match
            </Button>
            <Button variant="danger" onClick={() => void rejectCode()}>
              They don't match
            </Button>
          </div>
        </Card>
      );
    case "confirmed":
      return (
        <Card size="sm" stack>
          <Pending label={`Confirm the code on ${join.approverName} too…`} />
        </Card>
      );
    case "alreadyApproved":
      return (
        <Card size="sm" stack>
          <p className="aw-muted">
            {join.approverName} approved this browser while this page was
            closed. Check this code against the one it lists beside “{name}”
            under Settings → Account.
          </p>
          <div className="aw-sas">{join.sas}</div>
          <div className="aw-inline">
            <Button variant="primary" onClick={() => void confirmApproved()}>
              Codes match
            </Button>
            <Button variant="danger" onClick={() => void rejectApproved()}>
              Not this one
            </Button>
          </div>
        </Card>
      );
    case "denied":
    case "expired":
    case "failed":
      return (
        <Card size="sm" stack>
          <Banner tone={join.kind === "failed" ? "error" : "warning"}>
            {join.kind === "denied"
              ? "The request was turned down."
              : join.kind === "expired"
                ? "Nobody approved it within 10 minutes."
                : join.message}
          </Banner>
          <div className="aw-inline">
            <Button variant="primary" onClick={() => void retryJoin()}>
              Ask again
            </Button>
            {signOutButton}
          </div>
        </Card>
      );
    default:
      return (
        <Card size="sm" stack>
          <p className="aw-muted">
            On your iPhone, the Mac app or the desktop app, a prompt asks to
            let “{name}” in (or open Settings → Account → Waiting to join).
            Choose Review — both screens then show the same six-digit code.
          </p>
          <Pending
            label={
              join.kind === "requesting"
                ? "Asking your devices…"
                : "Waiting for approval…"
            }
          />
          <div>{signOutButton}</div>
        </Card>
      );
  }
}
