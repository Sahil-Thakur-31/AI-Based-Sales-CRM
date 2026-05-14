function normalizeLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildHeaderLabels(table) {
  const tableHead = table.tHead;
  if (!tableHead) return [];

  const grid = [];
  let maxColumns = 0;

  Array.from(tableHead.rows).forEach((row, rowIndex) => {
    let columnIndex = 0;

    Array.from(row.cells).forEach((cell) => {
      while (grid[rowIndex]?.[columnIndex]) {
        columnIndex += 1;
      }

      const label = normalizeLabel(cell.dataset.label || cell.textContent);
      const colSpan = Math.max(1, Number(cell.colSpan) || 1);
      const rowSpan = Math.max(1, Number(cell.rowSpan) || 1);

      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        const targetRow = rowIndex + rowOffset;
        if (!grid[targetRow]) {
          grid[targetRow] = [];
        }

        for (let colOffset = 0; colOffset < colSpan; colOffset += 1) {
          grid[targetRow][columnIndex + colOffset] = label;
        }
      }

      columnIndex += colSpan;
      maxColumns = Math.max(maxColumns, columnIndex);
    });
  });

  return Array.from({ length: maxColumns }, (_, columnIndex) => {
    const parts = [];

    for (let rowIndex = 0; rowIndex < grid.length; rowIndex += 1) {
      const label = normalizeLabel(grid[rowIndex]?.[columnIndex]);
      if (!label) continue;
      if (parts[parts.length - 1] !== label) {
        parts.push(label);
      }
    }

    return parts.join(" / ");
  });
}

function decorateTable(table) {
  const labels = buildHeaderLabels(table);
  if (!labels.length) return;

  const rows = Array.from(table.tBodies).flatMap((tbody) => Array.from(tbody.rows));

  rows.forEach((row) => {
    let columnIndex = 0;

    Array.from(row.cells).forEach((cell) => {
      const colSpan = Math.max(1, Number(cell.colSpan) || 1);
      const existingLabel = normalizeLabel(cell.getAttribute("data-label"));
      const resolvedLabel = existingLabel || (colSpan === 1 ? labels[columnIndex] || "" : "");

      if (resolvedLabel) {
        cell.setAttribute("data-label", resolvedLabel);
        cell.setAttribute("data-no-label", "false");
      } else {
        cell.removeAttribute("data-label");
        cell.setAttribute("data-no-label", "true");
      }

      if (colSpan > 1) {
        cell.setAttribute("data-no-label", "true");
      }

      columnIndex += colSpan;
    });
  });
}

export function decorateResponsiveTables(root = document) {
  if (!root?.querySelectorAll) return;

  const tables = root.querySelectorAll("table.crm-responsive-table, table.crm-auto-responsive-table");
  tables.forEach((table) => decorateTable(table));
}
