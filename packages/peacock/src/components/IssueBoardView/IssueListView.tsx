import type { IssueCardItem } from "./IssueBoardView";
import { GridScreen } from "../GridScreen/GridScreen";
import { IssueCard } from "../IssueCard/IssueCard";
import styles from "./IssueListView.module.css";

export interface IssueListSection {
  cards: IssueCardItem[];
  id: string;
  name: string;
}

export interface IssueListViewProps {
  onOpen: (identifier: string) => void;
  /** A section per status, its cards most urgent first. */
  sections: IssueListSection[];
  selected: string | null;
}

/** Sections per status, most urgent first within each. */
export function IssueListView({
  onOpen,
  sections,
  selected,
}: IssueListViewProps) {
  return (
    <>
      {sections.map((section) => (
        <GridScreen.Section
          key={section.id}
          title={section.name}
          count={section.cards.length}
        >
          <div className={styles.grid}>
            {section.cards.map((card) => (
              <IssueCard
                key={card.identifier}
                {...card}
                selected={card.identifier === selected}
                onClick={() => onOpen(card.identifier)}
              />
            ))}
          </div>
        </GridScreen.Section>
      ))}
    </>
  );
}
