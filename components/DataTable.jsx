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
  wrapColWidths = {},
  scrollHeight = null,
  leadingColWidths = [],
  gutterRight = 0,
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
    // leadingColWidths: 위에 있는 차트(TrendChart)와 x축(날짜) 위치를 맞추기 위한 정렬 모드.
    // 앞쪽 leadingColWidths.length개 열(라벨/요약 열)은 차트의 y축 폭과 똑같은 고정 px 폭으로,
    // 나머지 날짜 열들은 "(표 전체 폭 - 라벨 열 폭 합) ÷ 날짜 열 개수"로 똑같이 나눠서, 차트가
    // afterFit으로 고정한 y축 폭과 정확히 일치시킵니다(오른쪽 여백은 gutterRight로 별도 확보).
    if (leadingColWidths.length > 0) {
      if (ci < leadingColWidths.length) {
        const w = leadingColWidths[ci];
        // nowrap + overflow:visible: 숫자나 설명이 폭보다 살짝 길어도 잘리지 않고 그대로
        // 보이도록 한다(폭 자체를 내용에 맞게 넉넉히 잡는 게 우선이고, 이건 안전장치).
        return { width: w, minWidth: w, maxWidth: 'none', whiteSpace: 'nowrap', overflow: 'visible' };
      }
      const leadSum = leadingColWidths.reduce((s, w) => s + w, 0);
      const totalCols = rows[0]?.length || leadingColWidths.length + 1;
      const dateColCount = Math.max(totalCols - leadingColWidths.length, 1);
      return {
        width: `calc((100% - ${leadSum}px) / ${dateColCount})`,
        minWidth: 0,
        maxWidth: 'none',
        whiteSpace: 'nowrap',
        textAlign: 'center',
        overflow: 'visible',
      };
    }
    // colMaxWidths: 줄바꿈 없이 한 줄로 보여주되(내용이 길면 표 전체가 넓어져서
    // 가로 스크롤이 생기도록) 지정한 폭만큼은 확실히 확보합니다(width/minWidth).
    if (colMaxWidths[ci] !== undefined) {
      const w = colMaxWidths[ci];
      // 전역 td 규칙(max-width:260px, overflow:hidden)을 이 열에서만 해제합니다.
      return { width: w, minWidth: w, maxWidth: 'none', whiteSpace: 'nowrap', overflow: 'visible' };
    }
    // wrapColWidths: 지정한 폭 안에서 줄바꿈되도록(가로 스크롤 대신 셀 안에서 2~3줄로 접힘).
    if (wrapColWidths[ci] !== undefined) {
      const w = wrapColWidths[ci];
      return { width: w, maxWidth: w, whiteSpace: 'normal' };
    }
    if (narrowSet.has(ci)) return { maxWidth: 130, whiteSpace: 'normal' };
    if (wideSet.has(ci)) return { maxWidth: 1040, whiteSpace: 'normal' };
    return undefined;
  }

  const visibleRows = rows.filter((row, ri) => {
    if (ri < headerRowCount) return true;
    if (filterColumn === null || selected === 'ALL') return true;
    return cellText(row[filterColumn], mergeMode) === selected;
  });

  // 정렬 모드(leadingColWidths)에서는 table-layout:fixed + calc()로 폭을 강제하므로,
  // 화면이 좁아져도 날짜 열이 읽을 수 없을 만큼 눌리지 않도록 최소 폭을 확보해 그 아래로는
  // (기존 다른 표들처럼) 표 전체가 가로 스크롤되게 한다.
  let alignMinWidth;
  if (leadingColWidths.length > 0) {
    const leadSum = leadingColWidths.reduce((s, w) => s + w, 0);
    const totalCols = rows[0]?.length || leadingColWidths.length + 1;
    const dateColCount = Math.max(totalCols - leadingColWidths.length, 1);
    alignMinWidth = leadSum + dateColCount * 62;
  }

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
        style={{
          ...(scrollHeight ? { maxHeight: scrollHeight, overflowY: 'auto' } : {}),
          ...(gutterRight ? { paddingRight: gutterRight } : {}),
        }}
      >
        <table
          className={tableClassName || undefined}
          style={leadingColWidths.length > 0 ? { tableLayout: 'fixed', minWidth: alignMinWidth } : undefined}
        >
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
