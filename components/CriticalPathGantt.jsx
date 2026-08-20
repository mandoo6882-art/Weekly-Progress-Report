'use client';

import { useMemo } from 'react';

// Tab7 "Critical Path" 전용 월별 그리드 간트 차트. Chart.js 대신 순수 div로 그려
// task 한 행 안에 Plan/Actual(또는 Plan/Forecast/Actual) 바를 위아래로 겹치지 않게
// 쌓아서(stacked) 보여줍니다 — "plan/actual이 같은 행에 위아래로 보이게" 요구사항 반영.

const MONTH_WIDTH = 68;
const ROW_LABEL_WIDTH = 260;
const BAR_H = 13;
const BAR_GAP = 3;
const ROW_PAD = 6;

function startOfMonthUTC(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonthsUTC(d, n) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}
function monthLabel(d) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(-2)}`;
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${String(d.getUTCDate()).padStart(2, '0')}-${months[d.getUTCMonth()]}-${yy}`;
}

export default function CriticalPathGantt({ title, rows, legend = [] }) {
  const { months, minMs, totalMs } = useMemo(() => {
    let min = null;
    let max = null;
    (rows || []).forEach((r) => {
      (r.bars || []).forEach((b) => {
        if (b.start) {
          const t = new Date(b.start).getTime();
          if (!Number.isNaN(t)) {
            if (min === null || t < min) min = t;
            if (max === null || t > max) max = t;
          }
        }
        if (b.finish) {
          const t = new Date(b.finish).getTime();
          if (!Number.isNaN(t)) {
            if (min === null || t < min) min = t;
            if (max === null || t > max) max = t;
          }
        }
      });
    });
    if (min === null) return { months: [], minMs: 0, totalMs: 1 };

    const minD = startOfMonthUTC(new Date(min));
    const maxD = startOfMonthUTC(new Date(max));
    const list = [];
    let cur = addMonthsUTC(minD, -1); // 앞뒤로 한 달씩 여유
    const last = addMonthsUTC(maxD, 1);
    while (cur <= last) {
      list.push(cur);
      cur = addMonthsUTC(cur, 1);
    }
    const startMs = list[0].getTime();
    const endMs = addMonthsUTC(list[list.length - 1], 1).getTime();
    return { months: list, minMs: startMs, totalMs: endMs - startMs };
  }, [rows]);

  if (!months.length) {
    return <p className="empty-inline">표시할 일정 데이터가 없습니다.</p>;
  }

  const totalWidth = months.length * MONTH_WIDTH;

  function barGeom(bar) {
    if (!bar.start || !bar.finish) return null;
    const s = new Date(bar.start).getTime();
    const f = new Date(bar.finish).getTime();
    if (Number.isNaN(s) || Number.isNaN(f)) return null;
    const left = ((s - minMs) / totalMs) * totalWidth;
    const width = Math.max(3, ((f - s) / totalMs) * totalWidth);
    return { left, width };
  }

  return (
    <div className="cp-gantt-wrap">
      {title && <p className="table-title">{title}</p>}
      <div className="cp-gantt-scroll">
        <div style={{ width: ROW_LABEL_WIDTH + totalWidth }}>
          <div className="cp-gantt-header">
            <div className="cp-gantt-label cp-gantt-corner" style={{ width: ROW_LABEL_WIDTH }} />
            {months.map((m, i) => (
              <div key={i} className="cp-gantt-month" style={{ width: MONTH_WIDTH }}>
                {monthLabel(m)}
              </div>
            ))}
          </div>

          {rows.map((r, ri) => {
            if (r.isHeading) {
              return (
                <div key={ri} className="cp-gantt-row cp-gantt-heading">
                  <div className="cp-gantt-label" style={{ width: ROW_LABEL_WIDTH, paddingLeft: 8 + (r.depth || 0) * 12 }}>
                    {r.name}
                  </div>
                  <div className="cp-gantt-track" style={{ width: totalWidth }} />
                </div>
              );
            }
            const bars = r.bars || [];
            const rowH = bars.length * (BAR_H + BAR_GAP) + ROW_PAD;
            return (
              <div key={ri} className="cp-gantt-row cp-gantt-task" style={{ height: rowH }}>
                <div className="cp-gantt-label" style={{ width: ROW_LABEL_WIDTH, paddingLeft: 8 + (r.depth || 0) * 12 }}>
                  {r.name}
                </div>
                <div className="cp-gantt-track" style={{ width: totalWidth, height: rowH }}>
                  {months.map((m, i) => (
                    <div key={i} className="cp-gantt-gridline" style={{ left: i * MONTH_WIDTH }} />
                  ))}
                  {bars.map((b, bi) => {
                    const g = barGeom(b);
                    if (!g) return null;
                    return (
                      <div
                        key={bi}
                        className="cp-gantt-bar"
                        title={`${b.label}: ${fmtDate(b.start)} ~ ${fmtDate(b.finish)}`}
                        style={{
                          left: g.left,
                          width: g.width,
                          top: bi * (BAR_H + BAR_GAP) + ROW_PAD / 2,
                          height: BAR_H,
                          background: b.color,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {legend.length > 0 && (
        <div className="cp-gantt-legend">
          {legend.map((l, i) => (
            <span key={i} className="cp-gantt-legend-item">
              <span className="cp-gantt-legend-dot" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
