'use client';

import { useMemo, useState } from 'react';

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

function cellText(cell, mergeMode) {
  const v = mergeMode ? cell?.value : cell;
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

export default function DataTable({
  title,
  rows,
  headerRowCount = 1,
  narrowCols = [],
  wideCols = [],
  rowClasses = [],
  tableClassName = '',
  colWidths = [],
  filterColumn = null,
  filterLabel = '',
  colMaxWidths = {},
  scrollHeight = null,
}) {
  const [selected, setSelected] = useState('ALL');

  const mergeMode = isMergeGrid(rows || []);

  const filterOptions = useMemo(() => {
    if (filterColumn === null || !rows) return [];
    const set = new Set();
    rows.forEach((row, ri) => {
      if (ri < headerRowCount) return;
      const v = cellText(row[filterColumn], mergeMode);
      if (v) set.add(v);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [rows, filterColumn, headerRowCount, mergeMode]);

  if (!rows || !rows.length) return null;

  const narrowSet = new Set(narrowCols);
  const wideSet = new Set(wideCols);
  function colStyle(ci) {
    if (colMaxWidths[ci] !== undefined) return { maxWidth: colMaxWidths[ci], whiteSpace: 'normal' };
    if (narrowSet.has(ci)) return { maxWidth: 130, whiteSpace: 'normal' };
    if (wideSet.has(ci)) return { maxWidth: 1040, whiteSpace: 'normal' };
    return undefined;
  }

  const visibleRows = rows.filter((row, ri) => {
    if (ri < headerRowCount) return true;
    if (filterColumn === null || selected === 'ALL') return true;
    return cellText(row[filterColumn], mergeMode) === selected;
  });

  return (
    <div className="data-table-block">
      {(title || filterOptions.length > 1) && (
        <div className="table-title-row">
          {title && <h3 className="table-title">{title}</h3>}
          {filterOptions.length > 1 && (
            <label className="table-filter">
              {filterLabel || '필터'}:
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="ALL">전체</option>
                {filterOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      <div
        className={`table-wrap${scrollHeight ? ' has-scroll' : ''}`}
        style={scrollHeight ? { maxHeight: scrollHeight, overflowY: 'auto' } : undefined}
      >
        <table className={tableClassName || undefined}>
          {colWidths.length > 0 && (
            <colgroup>
              {colWidths.map((w, i) => (
                <col key={i} style={{ width: `${w}%` }} />
              ))}
            </colgroup>
          )}
          <tbody>
            {visibleRows.map((row, ri) => {
              if (mergeMode && !row.some((c) => !c.hidden)) return null; // 완전히 가려진 행은 렌더링 안 함

              const trCls = [ri < headerRowCount ? 'header-row' : '', rowClasses[ri] || ''].filter(Boolean).join(' ');
              return (
                <tr key={ri} className={trCls}>
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
                            style={colStyle(ci)}
                          >
                            {display}
                          </td>
                        );
                      })
                    : row.map((cell, ci) => {
                        const display = cell === null || cell === undefined || cell === '' ? '' : String(cell);
                        return (
                          <td
                            key={ci}
                            className={isNumericLike(cell) ? 'num-cell' : ''}
                            style={colStyle(ci)}
                          >
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
