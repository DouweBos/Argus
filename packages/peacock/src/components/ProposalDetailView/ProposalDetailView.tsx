import type { ReactNode } from "react";
import { ChevronLeftIcon, EnvelopeIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { EmptyState } from "../EmptyState/EmptyState";
import { Spinner } from "../Spinner/Spinner";
import styles from "./ProposalDetailView.module.css";

export interface ProposalLink {
  label: string;
  onClick: () => void;
}

export interface ProposalDetailViewProps {
  /** The proposal in full, usually a `ProposalCard`; null when it is gone. */
  card: ReactNode | null;
  /** Still being fetched: no card yet, and no verdict on whether it exists. */
  loading?: boolean;
  /** Where it came from and what it led to: the run, the automation, the session. */
  links: ProposalLink[];
  /** "Inbox" back button; omit where the shell has its own. */
  onBack?: () => void;
}

/**
 * One proposal in full. Home and the inbox show proposals in summary; this is
 * where the whole of one is readable and gets decided. A decided one still
 * reads here, its buttons gone.
 */
export function ProposalDetailView({
  card,
  links,
  loading,
  onBack,
}: ProposalDetailViewProps) {
  if (!card) {
    return loading ? (
      <div className={styles.loading}>
        <Spinner />
      </div>
    ) : (
      <EmptyState
        action={
          onBack && (
            <Button size="sm" onClick={onBack}>
              Back to the inbox
            </Button>
          )
        }
        body="It was decided on, or the computer that raised it is no longer attached."
        icon={<EnvelopeIcon size={18} />}
        title="This proposal is gone"
      />
    );
  }

  return (
    <div className={styles.view}>
      {onBack && (
        <header className={styles.head}>
          <Button
            leading={<ChevronLeftIcon size={10} />}
            size="sm"
            variant="ghost"
            onClick={onBack}
          >
            Inbox
          </Button>
        </header>
      )}
      {card}
      {links.length > 0 && (
        <div className={styles.provenance}>
          <span className={styles.label}>Came from</span>
          {links.map((link) => (
            <Button
              key={link.label}
              size="sm"
              variant="ghost"
              onClick={link.onClick}
            >
              {link.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
