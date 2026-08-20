'use client';

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  BarController,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, BarController);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '-';
  const d = new Date(ms);
  const yy = String(d.getFullYear()).slice(-2);
  return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${yy}`;
}

function toRange(part) {
  if (!part || (!part.start && !part.finish)) return null;
  const s = part.start ? new Date(part.start).getTime() : null;
  const f = part.finish ? new Date(part.finish).getTime() : null;
  if (s === null && f === null) return null;
  // 시작/종료 중 하나만 있으면 같은 날짜로 얇게라도 표시(막대가 아예 안 그려지는 것 방지)
  return [s ?? f, f ?? s];
}

// rows: [{ name, depth, isHeading, plan:{start,finish}, forecast:{...}, actual:{...} }, ...]
// (start/finish는 ISO 문자열 또는 null)
export default function GanttChart({ title, rows, planLabel = 'Plan', forecastLabel = 'Forecast' }) {
  if (!rows?.length) return null;

  const labels = rows.map((r) => (r.isHeading ? r.name.toUpperCase() : '   '.repeat(Math.max(0, r.depth - 1)) + r.name));

  const datasets = [
    { key: 'plan', label: planLabel, color: '#94a3b8' },
    { key: 'forecast', label: forecastLabel, color: '#f59e0b' },
    { key: 'actual', label: 'Actual', color: '#10b981' },
  ].map((d) => ({
    label: d.label,
    data: rows.map((r) => toRange(r[d.key])),
    backgroundColor: d.color,
    borderColor: d.color,
    borderRadius: 3,
    barPercentage: 0.7,
    categoryPercentage: 0.7,
  }));

  const data = { labels, datasets };

  const options = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: { display: !!title, text: title, font: { size: 13 } },
      legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const v = ctx.raw;
            if (!v) return `${ctx.dataset.label}: -`;
            return `${ctx.dataset.label}: ${fmtDate(v[0])} ~ ${fmtDate(v[1])}`;
          },
        },
      },
    },
    scales: {
      x: {
        type: 'linear',
        position: 'top',
        ticks: {
          font: { size: 10 },
          callback: (v) => fmtDate(v),
          maxRotation: 0,
        },
        grid: { color: '#eef1f4' },
      },
      y: {
        ticks: {
          font: (ctx) => (rows[ctx.index]?.isHeading ? { size: 11, weight: '700' } : { size: 10.5 }),
          color: (ctx) => (rows[ctx.index]?.isHeading ? '#111827' : '#374151'),
        },
        grid: { display: false },
      },
    },
  };

  const chartHeight = Math.max(220, rows.length * 24 + 60);

  return (
    <div style={{ height: chartHeight }}>
      <Chart type="bar" data={data} options={options} />
    </div>
  );
}
