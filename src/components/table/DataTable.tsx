// src/components/table/DataTable.tsx
import CellRenderer from "./CellRenderer";

export default function DataTable<Row>({
  columns,
  rows,
  onRowClick,
  getRowKey,
}: {
  columns: any[];
  rows: Row[];
  onRowClick?: (row: Row) => void;
  getRowKey?: (row: Row, index: number) => string;
}) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          {columns.map((c: any) => (
            <th key={c.key} style={{ width: c.width }}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>

      <tbody>
        {rows.map((row: Row, i: number) => {
          const key = getRowKey ? getRowKey(row, i) : String(i);

          return (
            <tr
              key={key}
              className={onRowClick ? "row-clickable" : ""}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map((c: any) => (
                <td key={c.key}>
                  <CellRenderer cell={c.render(row)} row={row} />
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}