const NUMERIC_RE = /^-?[\d,]+(\.\d+)?%?$/;

function isNumericLike(v) {
  if (typeof v === 'number') return true;
  if (typeof v === 'string') return NUMERIC_RE.test(v.trim());
  return false;
}

export default function DataTable({ title, rows }) {
  if (!rows || !rows.length) return null;

  return (
    <div className="data-table-block">
      {title && <h3 className="table-title">{title}</h3>}
      <div className="table-wrap">
        <table>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={ri === 0 ? 'first-row' : ''}>
                {row.map((cell, ci) => {
                  const display = cell === null || cell === undefined || cell === '' ? '' : String(cell);
                  return (
                    <td key={ci} className={isNumericLike(cell) ? 'num-cell' : ''}>
                      {display}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
