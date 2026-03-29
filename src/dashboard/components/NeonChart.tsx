'use client';

import { useEffect, useRef, useState } from 'react';

interface NeonChartProps {
  type: 'line' | 'bar' | 'doughnut';
  data: {
    labels: string[];
    datasets: Array<{
      label?: string;
      data: number[];
      borderColor?: string | string[];
      backgroundColor?: string | string[];
      fill?: boolean;
      tension?: number;
      borderWidth?: number;
      [key: string]: any;
    }>;
  };
  options?: Record<string, any>;
  height?: number;
}

const CYBER_COLORS = [
  '#00f0ff', // cyan
  '#ff00aa', // magenta
  '#00ff66', // green
  '#ffaa00', // amber
  '#ff3344', // red
  '#8b5cf6', // purple
];

export default function NeonChart({ type, data, options = {}, height = 280 }: NeonChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<any>(null);
  const [chartLoaded, setChartLoaded] = useState(false);
  const ChartJSRef = useRef<any>(null);

  // Dynamically import Chart.js
  useEffect(() => {
    let cancelled = false;

    const loadChart = async () => {
      try {
        const chartModule = await import('chart.js');
        const {
          Chart,
          CategoryScale,
          LinearScale,
          PointElement,
          LineElement,
          BarElement,
          ArcElement,
          Title,
          Tooltip,
          Legend,
          Filler,
        } = chartModule;

        Chart.register(
          CategoryScale,
          LinearScale,
          PointElement,
          LineElement,
          BarElement,
          ArcElement,
          Title,
          Tooltip,
          Legend,
          Filler
        );

        if (!cancelled) {
          ChartJSRef.current = Chart;
          setChartLoaded(true);
        }
      } catch {
        // Chart.js import failed
      }
    };

    loadChart();
    return () => { cancelled = true; };
  }, []);

  // Create / update chart
  useEffect(() => {
    if (!chartLoaded || !canvasRef.current || !ChartJSRef.current) return;

    const Chart = ChartJSRef.current;

    // Auto-style datasets with cyberpunk colors
    const styledData = {
      ...data,
      datasets: data.datasets.map((ds, i) => {
        const color = ds.borderColor || CYBER_COLORS[i % CYBER_COLORS.length];
        const baseStyle: Record<string, any> = {
          ...ds,
          borderColor: color,
        };

        if (type === 'line') {
          baseStyle.backgroundColor = ds.backgroundColor || `${color}11`;
          baseStyle.fill = ds.fill !== undefined ? ds.fill : true;
          baseStyle.tension = ds.tension !== undefined ? ds.tension : 0.4;
          baseStyle.borderWidth = ds.borderWidth || 2;
          baseStyle.pointBackgroundColor = color;
          baseStyle.pointBorderColor = color;
          baseStyle.pointRadius = 2;
          baseStyle.pointHoverRadius = 5;
          baseStyle.pointHoverBackgroundColor = '#fff';
        } else if (type === 'bar') {
          baseStyle.backgroundColor = ds.backgroundColor || `${color}66`;
          baseStyle.borderWidth = ds.borderWidth || 1;
          baseStyle.borderRadius = 3;
          baseStyle.hoverBackgroundColor = color;
        } else if (type === 'doughnut') {
          if (!ds.backgroundColor) {
            baseStyle.backgroundColor = CYBER_COLORS.slice(0, ds.data.length);
          }
          baseStyle.borderColor = '#111118';
          baseStyle.borderWidth = 2;
          baseStyle.hoverBorderColor = '#00f0ff';
        }

        return baseStyle;
      }),
    };

    // Cyberpunk chart options
    const cyberOptions = {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 600,
        easing: 'easeOutQuart' as const,
      },
      plugins: {
        legend: {
          display: data.datasets.length > 1 || type === 'doughnut',
          labels: {
            color: '#666',
            font: { family: 'monospace', size: 11 },
            boxWidth: 12,
            padding: 16,
          },
        },
        tooltip: {
          backgroundColor: '#111118ee',
          titleColor: '#e0e0e0',
          bodyColor: '#e0e0e0',
          borderColor: '#1a1a24',
          borderWidth: 1,
          titleFont: { family: 'monospace', size: 11 },
          bodyFont: { family: 'monospace', size: 11 },
          padding: 10,
          cornerRadius: 4,
          displayColors: true,
        },
      },
      scales: type !== 'doughnut' ? {
        x: {
          grid: {
            color: '#1a1a2444',
            drawBorder: false,
          },
          ticks: {
            color: '#555',
            font: { family: 'monospace', size: 10 },
            maxRotation: 45,
          },
          border: {
            color: '#1a1a24',
          },
        },
        y: {
          grid: {
            color: '#1a1a2444',
            drawBorder: false,
          },
          ticks: {
            color: '#555',
            font: { family: 'monospace', size: 10 },
          },
          border: {
            color: '#1a1a24',
          },
        },
      } : undefined,
      ...options,
    };

    // Destroy existing chart
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    chartRef.current = new Chart(ctx, {
      type,
      data: styledData,
      options: cyberOptions,
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [chartLoaded, type, data, options]);

  return (
    <div style={{
      background: '#111118',
      border: '1px solid #1a1a24',
      borderRadius: 8,
      padding: 16,
      position: 'relative',
    }}>
      {!chartLoaded && (
        <div style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#333',
          fontFamily: 'monospace',
          fontSize: '0.75rem',
        }}>
          Loading chart...
        </div>
      )}
      <div style={{ height, display: chartLoaded ? 'block' : 'none' }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
