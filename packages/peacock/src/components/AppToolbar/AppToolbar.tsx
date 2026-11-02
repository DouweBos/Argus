import { Fragment, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "../../icons/Icons";
import { FlatIconButton } from "../FlatIconButton/FlatIconButton";
import { ProjectBadge } from "../ProjectBadge/ProjectBadge";
import styles from "./AppToolbar.module.css";

export interface AppToolbarProps {
  /** Before history: the sidebar toggle while the sidebar is away. */
  leading?: ReactNode;
  onBack?: () => void;
  onForward?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  /** Where you are: an `AppBreadcrumb` or an `AppToolbarTitle`. */
  title?: ReactNode;
  /** A screen's own actions, then the panel toggles, at the far end. */
  trailing?: ReactNode;
}

/** The flat bar over the centre, as Argus for Mac draws its window toolbar. */
export function AppToolbar({
  leading,
  onBack,
  onForward,
  canGoBack = true,
  canGoForward = false,
  title,
  trailing,
}: AppToolbarProps) {
  return (
    <header className={styles.toolbar}>
      {leading}
      {(onBack || onForward) && (
        <div className={styles.history}>
          <FlatIconButton
            disabled={!canGoBack}
            icon={<ChevronLeftIcon size={14} />}
            label="Back"
            onClick={onBack}
          />
          <FlatIconButton
            disabled={!canGoForward}
            icon={<ChevronRightIcon size={14} />}
            label="Forward"
            onClick={onForward}
          />
        </div>
      )}
      <div className={styles.title}>{title}</div>
      {trailing && <div className={styles.trailing}>{trailing}</div>}
    </header>
  );
}

/** An overview's name over a one-line summary ("Inbox / No decisions waiting"). */
export function AppToolbarTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className={styles.titleStack}>
      <span className={styles.titleText}>{title}</span>
      {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
    </div>
  );
}

export interface BreadcrumbStep {
  label: string;
  /** Wears the project's badge before it. */
  project?: { name: string; key: string };
  onClick?: () => void;
  tooltip?: string;
}

/** "Project / Session / Agent": earlier steps can be clicked. The last is the screen. */
export function AppBreadcrumb({ steps }: { steps: BreadcrumbStep[] }) {
  return (
    <nav aria-label="Breadcrumb" className={styles.crumbs}>
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        const body = (
          <>
            {step.project && (
              <ProjectBadge
                name={step.project.name}
                projectKey={step.project.key}
              />
            )}
            <span className={styles.crumbLabel}>{step.label}</span>
          </>
        );

        return (
          <Fragment key={`${i}:${step.label}`}>
            {i > 0 && <span className={styles.separator}>/</span>}
            {step.onClick && !last ? (
              <button
                className={styles.crumb}
                title={step.tooltip ?? step.label}
                type="button"
                onClick={step.onClick}
              >
                {body}
              </button>
            ) : (
              <span
                aria-current={last ? "page" : undefined}
                className={styles.crumb}
                data-current={last || undefined}
                title={step.tooltip ?? step.label}
              >
                {body}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
