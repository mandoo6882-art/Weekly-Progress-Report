'use client';

import { useMemo, useState } from 'react';
import DataTable from './DataTable';
import TrendChart from './TrendChart';
import GanttChart from './GanttChart';
import CriticalPathGantt from './CriticalPathGantt';
import CriticalPathSchedule from './CriticalPathSchedule';
import { getTabConfig } from '../lib/tabConfig';

export default function TabView({ tabs }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id);

  // tab_number가 같은 탭들은 하나의 그룹(상위 탭 + sub tab들)으로 묶는다(예: 7번 탭).
  const groups = useMemo(() => {
    const map = new Map();
    tabs.forEach((t) => {
      if (!map.has(t.tab_number)) map.set(t.tab_number, []);
      map.get(t.tab_number).push(t);
    });
    return [...map.values()];
  }, [tabs]);

  if (!tabs.length) {
    return <p className="empty">탭 정보를 불러올 수 없습니다.</p>;
  }

  const active = tabs.find((t) => t.id === activeId) || tabs[0];
  const activeGroup = groups.find((g) => g.some((t) => t.id === active.id)) || [active];
  const isGrouped = activeGroup.length > 1;

  const data = active?.data || { blocks: [] };
  const blocks = data.blocks || [];

  return (
    <div>
      <div className="tab-bar">
        {groups.map((g) => {
          const isActiveGroup = g.some((t) => t.id === active.id);
          const label =
            g.length > 1
              ? `${g[0].tab_number}. ${getTabConfig(g[0].id)?.groupLabel || g[0].name}`
              : `${g[0].tab_number}. ${g[0].name}`;
          return (
            <button
              key={g[0].id}
              type="button"
              className={`tab-btn ${isActiveGroup ? 'active' : ''}`}
              onClick={() => setActiveId(isActiveGroup ? active.id : g[0].id)}
            >
              {label}
            </button>
          );
        })}
      </div>

      {isGrouped && (
        <div className="subtab-bar">
          {activeGroup.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`subtab-btn ${t.id === active.id ? 'active' : ''}`}
              onClick={() => setActiveId(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      <div className="tab-meta">
        {active.source_file ? (
          <span>
            원본: {active.source_file}
            {active.as_of ? ` (as of ${active.as_of})` : ''}
          </span>
        ) : (
          <span className="empty-inline">아직 업로드된 데이터가 없습니다.</span>
        )}
      </div>

      {data.title ? <h2 className="section-title">{data.title}</h2> : null}

      {active.id === 'equipment-control' ? (
        active.status_viewer_url ? (
          <a
            href="/api/equipment-status"
            target="_blank"
            rel="noopener noreferrer"
            className="status-viewer-link"
          >
            Check the equipment status on the plot plan →
          </a>
        ) : (
          <p className="empty-inline" style={{ marginBottom: 16 }}>
            Equipment Status Viewer 파일이 아직 업로드되지 않았습니다.
          </p>
        )
      ) : null}

      {data.cutoffDate ? (
        <div className="cutoff-banner">Cut-off date: {data.cutoffDate}</div>
      ) : null}

      {active.note ? (
        <div className="note-display">
          <strong>담당자 노트</strong>
          <p>{active.note}</p>
        </div>
      ) : null}

      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          return (
            <h3 key={i} className="section-heading">
              {b.text}
            </h3>
          );
        }
        if (b.type === 'chart') {
          return (
            <div key={i} className="chart-box standalone-chart">
              <TrendChart title={b.title} categories={b.categories} series={b.series} format={b.format || 'percent'} />
            </div>
          );
        }
        if (b.type === 'gantt') {
          return (
            <div key={i} className="chart-box standalone-chart gantt-box">
              <GanttChart title={b.title} rows={b.rows} planLabel={b.planLabel} forecastLabel={b.forecastLabel} />
            </div>
          );
        }
        if (b.type === 'critical-path-gantt') {
          return (
            <div key={i} className="chart-box standalone-chart">
              <CriticalPathGantt title={b.title} rows={b.rows} legend={b.legend} />
            </div>
          );
        }
        if (b.type === 'critical-path-schedule') {
          return (
            <CriticalPathSchedule
              key={i}
              title={b.title}
              columns={b.columns}
              rows={b.rows}
              legend={b.legend}
            />
          );
        }
        return (
          <DataTable
            key={i}
            title={b.title}
            rows={b.rows}
            headerRowCount={b.headerRowCount ?? 1}
            narrowCols={b.narrowCols || []}
            wideCols={b.wideCols || []}
            rowClasses={b.rowClasses || []}
            tableClassName={b.tableClassName || ''}
            colWidths={b.colWidths || []}
            filterColumn={b.filterColumn ?? null}
            filterLabel={b.filterLabel || ''}
            colMaxWidths={b.colMaxWidths || {}}
            wrapColWidths={b.wrapColWidths || {}}
            scrollHeight={b.scrollHeight ?? null}
          />
        );
      })}
    </div>
  );
}
