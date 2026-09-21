import styles from "./ReportTable.module.css";

export type ReportCell = number | string;

export interface ReportTableProps {
  columns: string[];
  rows: ReportCell[][];
}

/** The `table` block. Numeric cells right-align so columns of figures read. */
export function ReportTable({ columns, rows }: ReportTableProps) {
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((column, i) => (
              <th key={`${column}-${i}`} className={styles.head} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={styles.row}>
              {row.map((cell, c) => (
                <td
                  key={c}
                  className={
                    typeof cell === "number"
                      ? `${styles.cell} ${styles.numeric}`
                      : styles.cell
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className={styles.empty}>No rows.</p>}
    </div>
  );
}
