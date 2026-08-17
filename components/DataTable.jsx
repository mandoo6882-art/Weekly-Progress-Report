const NUMERIC_RE = /^-?[\d,]+(\.\d+)?%?$/;

function isNumericLike(v) {
  if (typeof v === 'number') return true;
  if (typeof v === 'string') return NUMERIC_RE.test(v.trim());
  return false;
}

function isMergeGrid(rows) {
  return (
    rows.length > 0 &&
    rows[0].length > 0 &&
    typeof rows[0][0] === 'object' &&
    rows[0][0] !== null &&
    'value' in rows[0][0]
  );
}

export default function DataTable({ title, rows, headerRowCount = 1 }) {
  if (!rows || !rows.length) return null;

  const mergeMode = isMergeGrid(rows);

  return (
    <div className="data-table-block">
      {title && <h3 className="table-title">{title}</h3>}
      <div className="table-wrap">
        <table>
          <tbody>
            {rows.map((row, ri) => {
              if (mergeMode && !row.some((c) => !c.hidden)) return null; // 완전히 가려진 행은 렌더링 안 함

              return (
                <tr key={ri} className={ri < headerRowCount ? 'header-row' : ''}>
                  {mergeMode
                    ? row.map((cell, ci) => {
                        if (cell.hidden) return null;
                        const display =
                          cell.value === null || cell.value === undefined || cell.value === ''
                            ? ''
                            : String(cell.value);
                        const cls = [isNumericLike(cell.value) ? 'num-cell' : '', cell.cls || ''].filter(Boolean).join(' ');
                        return (
                          <td
                            key={ci}
                            colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                            rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                            className={cls}
                          >
                            {display}
                          </td>
                        );
                      })
                    : row.map((cell, ci) => {
                        const display = cell === null || cell === undefined || cell === '' ? '' : String(cell);
                        return (
                          <td key={ci} className={isNumericLike(cell) ? 'num-cell' : ''}>
                            {display}
                          </td>
                        );
                      })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
