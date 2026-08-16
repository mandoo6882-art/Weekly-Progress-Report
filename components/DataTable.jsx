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
                {row.map((cell, ci) => (
                  <td key={ci}>
                    {cell === null || cell === undefined || cell === '' ? '' : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
