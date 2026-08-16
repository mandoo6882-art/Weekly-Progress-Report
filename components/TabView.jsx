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
  const data = active?.data || { tables: [], charts: [] };

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

      {active.note ? (
        <div className="note-display">
          <strong>담당자 노트</strong>
          <p>{active.note}</p>
        </div>
      ) : null}

      {data.tables?.map((t, i) => (
        <DataTable key={i} title={t.title} rows={t.rows} />
      ))}

      {data.charts?.length > 0 && (
        <div className="chart-grid">
          {data.charts.map((c, i) => (
            <div key={i} className="chart-box">
              <TrendChart title={c.title} categories={c.categories} series={c.series} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
