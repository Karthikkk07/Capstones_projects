import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { useState } from 'react';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import type { RevenueSummary } from '../api/types';
import { monthlyChartData, perCourseChartData } from '../lib/chartData';

ChartJS.register(ArcElement, BarElement, CategoryScale, Legend, LinearScale, LineElement, PointElement, Tooltip);

export function RevenueCharts({ summary }: { summary: RevenueSummary }) {
  const [kind, setKind] = useState<'bar' | 'line'>('bar');
  const monthly = monthlyChartData(summary.monthly);
  const options = { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } };

  return (
    <div className="grid-2">
      <section className="card">
        <div className="row between">
          <h3>Monthly revenue</h3>
          <select value={kind} onChange={(e) => setKind(e.target.value as 'bar' | 'line')} aria-label="Chart type">
            <option value="bar">Bar</option>
            <option value="line">Line</option>
          </select>
        </div>
        {kind === 'bar' ? <Bar data={monthly} options={options} /> : <Line data={monthly} options={options} />}
      </section>
      <section className="card">
        <h3>Revenue by course</h3>
        {summary.perCourse.length === 0 ? (
          <p className="muted">No sales yet.</p>
        ) : (
          <Doughnut data={perCourseChartData(summary.perCourse)} />
        )}
      </section>
    </div>
  );
}
