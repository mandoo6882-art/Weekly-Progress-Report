'use client';

import { useState } from 'react';
import DataTable from './DataTable';
import TrendChart from './TrendChart';

export default function TabView({ tabs }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id);

  if (!tabs.length) {
    return <p className="empty">탭 정보를 불러올 수 없습니다.</p>;
  }

  const active = tabs.find((t) => t.id === activeId) || tabs[0];
  const data = active?.data || { blocks: [] };
  const blocks = data.blocks || [];

  return (
    <div>
      <div className="tab-bar">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab-btn ${t.id === active?.id ? 'active' : ''}`}
            onClick={() => setActiveId(t.id)}
          >
            {t.tab_number}. {t.name}
          </button>
        ))}
      </div>

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
        if (b.type === 'chart') {
          return (
            <div key={i} className="chart-box standalone-chart">
              <TrendChart title={b.title} categories={b.categories} series={b.series} />
            </div>
          );
        }
        return (
          <DataTable key={i} title={b.title} rows={b.rows} headerRowCount={b.headerRowCount ?? 1} narrowCols={b.narrowCols || []} />
        );
      })}
    </div>
  );
}
