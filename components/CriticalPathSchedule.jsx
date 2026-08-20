'use client';

import { useMemo } from 'react';

// Tab7 "Critical Path" 전용: 엑셀 원본처럼 좌측 데이터 열(Activity/Duration/Plan/Actual/Remark)과
// 우측 월별 bar 차트를 한 행 안에 이어붙여서 보여주는 컴포넌트. 좌측 열은 가로 스크롤 중에도
// 화면에 고정(sticky)되어, 오른쪽으로 스크롤해서 달을 넘겨봐도 어떤 작업의 bar인지 항상 보입니다.
// Plan/Actual(또는 Plan/Forecast/Actual) bar는 같은 행 안에서 위아래로 쌓아(stacked) 그립니다.

const MONTH_WIDTH = 34;
const BAR_H = 13;
const BAR_GAP = 3;
const ROW_PAD = 6;
const SCHEDULE_MAX_HEIGHT = 560;

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

export default function CriticalPathSchedule({ title, columns = [], rows = [], legend = [] }) {
  const labelWidth = columns.reduce((s, c) => s + c.width, 0);

  const { months, minMs, totalMs } = useMemo(() => {
    let min = null;
    let max = null;
    rows.forEach((r) => {
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
    let cur = addMonthsUTC(minD, -1);
    const last = addMonthsUTC(maxD, 1);
    while (cur <= last) {
      list.push(cur);
      cur = addMonthsUTC(cur, 1);
    }
    const startMs = list[0].getTime();
    const endMs = addMonthsUTC(list[list.length - 1], 1).getTime();
    return { months: list, minMs: startMs, totalMs: endMs - startMs };
  }, [rows]);

  if (!rows.length) return <p className="empty-inline">표시할 일정 데이터가 없습니다.</p>;

  const totalTrackWidth = Math.max(months.length * MONTH_WIDTH, MONTH_WIDTH);

  function barGeom(bar) {
    if (!bar.start || !bar.finish || !months.length) return null;
    const s = new Date(bar.start).getTime();
    const f = new Date(bar.finish).getTime();
    if (Number.isNaN(s) || Number.isNaN(f)) return null;
    const left = ((s - minMs) / totalMs) * totalTrackWidth;
    const width = Math.max(3, ((f - s) / totalMs) * totalTrackWidth);
    return { left, width };
  }

  return (
    <div className="cp-sched-wrap">
      {title && <p className="table-title">{title}</p>}
      {legend.length > 0 && (
        <div className="cp-gantt-legend cp-gantt-legend-top">
          {legend.map((l, i) => (
            <span key={i} className="cp-gantt-legend-item">
              <span className="cp-gantt-legend-dot" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
      <div className="cp-sched-scroll" style={{ maxHeight: SCHEDULE_MAX_HEIGHT }}>
        <div style={{ width: labelWidth + totalTrackWidth }}>
          <div className="cp-sched-row cp-sched-header-row">
            <div className="cp-sched-sticky cp-sched-head" style={{ width: labelWidth }}>
              {columns.map((c, i) => (
                <div key={i} className="cp-sched-cell cp-sched-head-cell" style={{ width: c.width }}>
                  {c.label}
                </div>
              ))}
            </div>
            <div className="cp-sched-track" style={{ width: totalTrackWidth }}>
              {months.map((m, i) => (
                <div key={i} className="cp-gantt-month" style={{ width: MONTH_WIDTH }}>
                  {monthLabel(m)}
                </div>
              ))}
            </div>
          </div>

          {rows.map((r, ri) => {
            const alt = ri % 2 === 1 ? ' cp-sched-alt' : '';
            if (r.isHeading) {
              return (
                <div key={ri} className={`cp-sched-row cp-sched-heading${alt}`}>
                  <div
                    className="cp-sched-sticky cp-sched-heading-label"
                    style={{ width: labelWidth, paddingLeft: 8 + (r.depth || 0) * 12 }}
                  >
                    {r.name}
                  </div>
                  <div className="cp-sched-track" style={{ width: totalTrackWidth }} />
                </div>
              );
            }
            const bars = r.bars || [];
            const rowH = Math.max(26, bars.length * (BAR_H + BAR_GAP) + ROW_PAD);
            return (
              <div key={ri} className={`cp-sched-row cp-sched-task${alt}`} style={{ minHeight: rowH }}>
                <div className="cp-sched-sticky" style={{ width: labelWidth }}>
                  {columns.map((c, ci) => (
                    <div
                      key={ci}
                      className={`cp-sched-cell${c.wrap ? ' cp-sched-cell-wrap' : ''}`}
                      style={{ width: c.width }}
                    >
                      {r.cells?.[ci] ?? ''}
                    </div>
                  ))}
                </div>
                <div className="cp-sched-track" style={{ width: totalTrackWidth }}>
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
    </div>
  );
}
