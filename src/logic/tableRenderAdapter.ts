// tableRenderAdapter.ts
import type { ColumnDef, CellModel } from "./tableColumnDefs";

/**
 * Escape HTML for safe rendering in strings
 */
function esc(s: any): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Map Tone -> CSS class name (you can style these classes later)
 */
function toneClass(tone: string): string {
  return `tone-${tone}`;
}

/**
 * Render a CellModel to an HTML string.
 * Later, you can create a React version that returns JSX instead.
 */
export function renderCellToHTML(cell: CellModel): string {
  switch (cell.type) {
    case "text": {
      const secondary = cell.secondary
        ? `<div class="cell-secondary">${esc(cell.secondary)}</div>`
        : "";
      return `
        <div class="cell-text">
          <div class="cell-primary">${esc(cell.primary)}</div>
          ${secondary}
        </div>
      `.trim();
    }

    case "chip": {
      return `
        <span class="chip ${toneClass(cell.tone)}">${esc(cell.label)}</span>
      `.trim();
    }

    case "chips": {
      const chips = cell.chips
        .map((c) => `<span class="chip ${toneClass(c.tone)}">${esc(c.label)}</span>`)
        .join("");
      return `<div class="chip-row">${chips}</div>`;
    }

    case "actions": {
      const primary = cell.primary
        ? `<button class="btn btn-primary" data-action="${esc(cell.primary.action)}">${esc(cell.primary.label)}</button>`
        : "";

      const secondary = cell.secondary
        .map(
          (a) =>
            `<button class="btn btn-ghost" data-action="${esc(a.action)}">${esc(a.label)}</button>`
        )
        .join("");

      return `
        <div class="actions-cell">
          ${primary}
          <div class="actions-secondary">${secondary}</div>
        </div>
      `.trim();
    }

    default:
      return `<div></div>`;
  }
}

/**
 * Render a table row to HTML
 */
export function renderRowToHTML<Row>(
  columns: ColumnDef<Row>[],
  row: Row
): string {
  const tds = columns
    .map((col) => {
      const cell = col.render(row);
      const widthStyle = col.width ? ` style="width:${col.width}px"` : "";
      return `<td${widthStyle}>${renderCellToHTML(cell)}</td>`;
    })
    .join("");

  return `<tr>${tds}</tr>`;
}

/**
 * Render full table to HTML
 */
export function renderTableToHTML<Row>(
  columns: ColumnDef<Row>[],
  rows: Row[]
): string {
  const thead = `
    <thead>
      <tr>
        ${columns
          .map((c) => {
            const widthStyle = c.width ? ` style="width:${c.width}px"` : "";
            return `<th${widthStyle}>${esc(c.header)}</th>`;
          })
          .join("")}
      </tr>
    </thead>
  `.trim();

  const tbody = `
    <tbody>
      ${rows.map((r) => renderRowToHTML(columns, r)).join("")}
    </tbody>
  `.trim();

  return `<table class="data-table">${thead}${tbody}</table>`;
}