'use client';

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  BarController,
  LineController,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  BarController,
  LineController
);

const COLORS = ['#3b82f6', '#f59e0b', '#ef4444', '#10b981'];

export default function TrendChart({ title, categories, series, format = 'percent' }) {
  if (!categories?.length || !series?.length) return null;

  const formatValue = (v) => {
    if (typeof v !== 'number') return '-';
    if (format === 'integer') return Math.round(v).toLocaleString('en-US');
    return `${(v * 100).toFixed(1)}%`;
  };

  const hasBar = series.some((s) => s.type === 'bar');
  const hasLine = series.some((s) => s.type !== 'bar');
  const useDualAxis = hasBar && hasLine;

  const data = {
    labels: categories,
    datasets: series.map((s, i) => ({
      type: s.type === 'line' ? 'line' : 'bar',
      label: s.label,
      data: s.data,
      backgroundColor: COLORS[i % COLORS.length],
      borderColor: COLORS[i % COLORS.length],
      tension: 0.3,
      spanGaps: true,
      yAxisID: useDualAxis && s.type === 'bar' ? 'y1' : 'y',
    })),
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: { display: !!title, text: title, font: { size: 13 } },
      legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${formatValue(ctx.parsed?.y)}`,
        },
      },
    },
    scales: {
      y: {
        type: 'linear',
        position: 'left',
        ticks: {
          callback: (v) => formatValue(v),
          font: { size: 10 },
        },
        title: useDualAxis ? { display: true, text: format === 'integer' ? '누적' : '누적(%)', font: { size: 10 } } : undefined,
      },
      ...(useDualAxis
        ? {
            y1: {
              type: 'linear',
              position: 'right',
              ticks: {
                callback: (v) => formatValue(v),
                font: { size: 10 },
              },
              grid: { drawOnChartArea: false },
              title: { display: true, text: format === 'integer' ? '증분' : '증분(%)', font: { size: 10 } },
            },
          }
        : {}),
      x: { ticks: { font: { size: 10 } } },
    },
  };

  const chartHeight = hasBar ? 260 : 130; // 콤보(막대 포함) 차트는 원래 크기, Variance 단독 차트만 절반 크기

  return (
    <div style={{ height: chartHeight }}>
      <Chart type="bar" data={data} options={options} />
    </div>
  );
}
