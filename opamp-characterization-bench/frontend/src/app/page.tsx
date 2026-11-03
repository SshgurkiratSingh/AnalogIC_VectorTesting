'use client';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Title,
  Filler,
} from 'chart.js';
import { Scatter } from 'react-chartjs-2';
import { useWebSerial } from '@/hooks/useWebSerial';
import {
  SystemMode,
  SweepPoint,
  ExtractedParameters,
  LogEntry,
  INPUT_MUX_CHANNELS_A,
  INPUT_MUX_CHANNELS_B,
  FEEDBACK_MUX_CHANNELS,
  MUX_PAGE2_PINS,
  MUX_PAGE4_PINS,
  MUX_PAGE5_PINS,
} from '@/types/protocol';
import {
  linregress,
  computeGains,
  gainTodB,
  estimateSlewRate,
  sweepToCSV,
  downloadString,
  formatTs,
} from '@/utils/dsp';

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, Title, Filler);

// ─── Sweep defaults ───────────────────────────────────────────────────────────
const DEFAULT_SWEEP = { start: 0.0, stop: 4.5, step: 0.05 };

// ─── Tab definitions ──────────────────────────────────────────────────────────
type Tab = 'sweep' | 'gain' | 'manual' | 'calibration' | 'protocol' | 'pinmap';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function clsx(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function MetricCard({ label, value, unit, color = 'text-amber-400', sub }: {
  label: string; value: string | undefined; unit?: string; color?: string; sub?: string;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex flex-col gap-1">
      <span className="text-slate-500 text-[10px] tracking-widest uppercase">{label}</span>
      <span className={`text-2xl font-black font-mono ${color}`}>
        {value ?? <span className="text-slate-700">---</span>}
        {value !== undefined && unit && <span className="text-sm ml-1 text-slate-400">{unit}</span>}
      </span>
      {sub && <span className="text-slate-600 text-[10px]">{sub}</span>}
    </div>
  );
}

function SectionHeader({ title, badge }: { title: string; badge?: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <h2 className="text-xs font-bold tracking-widest uppercase text-emerald-400">{title}</h2>
      {badge && (
        <span className="text-[10px] bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 px-2 py-0.5 rounded-full">
          {badge}
        </span>
      )}
      <div className="flex-1 border-t border-slate-800" />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function BenchDashboard() {
  const [mode, setMode] = useState<SystemMode>('IDLE');
  const [activeTab, setActiveTab] = useState<Tab>('sweep');
  const [params, setParams] = useState<ExtractedParameters>({});
  const [sweepData, setSweepData] = useState<SweepPoint[]>([]);
  const [sweepRunning, setSweepRunning] = useState(false);
  const sweepStartTs = useRef<number>(0);

  // Sweep config
  const [sweepCfg, setSweepCfg] = useState(DEFAULT_SWEEP);

  // Custom Gain state
  const [gainInputCh, setGainInputCh] = useState(2);
  const [gainFbCh, setGainFbCh] = useState(0);
  const [gainBank, setGainBank] = useState<'A' | 'B'>('A');

  // Manual route state
  const [manualMux, setManualMux] = useState<'U4' | 'U6' | 'U7' | 'U8' | 'U10'>('U4');
  const [manualCh, setManualCh] = useState(0);

  // Calibration
  const [calBenchGain, setCalBenchGain] = useState(100);

  // Console auto-scroll
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Computed metrics
  const computedGain = sweepData.length >= 2
    ? linregress(sweepData.map(p => p.vin), sweepData.map(p => p.vout))
    : null;
  const gainDB = computedGain ? gainTodB(computedGain.slope) : null;
  const slewRate = sweepData.length >= 2 ? estimateSlewRate(sweepData) : null;

  // ─── Serial line handler ────────────────────────────────────────────────────
  const handleSerialLine = useCallback((line: string) => {
    try {
      const parsed = JSON.parse(line);

      // Parameter extraction events
      if (parsed.event === 'PARAM_DATA') {
        setParams(prev => ({
          ...prev,
          ...(parsed.vos_mv !== undefined ? { vos_mv: parsed.vos_mv } : {}),
          ...(parsed.ib_na !== undefined ? { ib_na: parsed.ib_na } : {}),
          ...(parsed.aol_db !== undefined ? { aol_db: parsed.aol_db } : {}),
          ...(parsed.cmrr_db !== undefined ? { cmrr_db: parsed.cmrr_db } : {}),
          ...(parsed.psrr_db !== undefined ? { psrr_db: parsed.psrr_db } : {}),
          ...(parsed.bandwidth_khz !== undefined ? { bandwidth_khz: parsed.bandwidth_khz } : {}),
        }));
      }

      // Sweep / gain data point
      if (parsed.vin !== undefined && parsed.vout !== undefined) {
        const ts = Date.now() - sweepStartTs.current;
        const gain = Math.abs(parsed.vin) > 0.01 ? parsed.vout / parsed.vin : undefined;
        setSweepData(prev => [...prev, { vin: parsed.vin, vout: parsed.vout, gain, timestamp: ts }]);
      }

      // Sweep events
      if (parsed.event === 'SWEEP_START' || parsed.event === 'CUSTOM_GAIN_START') {
        sweepStartTs.current = Date.now();
        setSweepRunning(true);
      }
      if (parsed.event === 'SWEEP_COMPLETE' || parsed.event === 'CUSTOM_GAIN_COMPLETE' || parsed.event === 'AUTO_COMPLETE') {
        setSweepRunning(false);
        setMode('IDLE');
      }
    } catch {
      // Non-JSON telemetry – already logged by hook
    }
  }, []);

  const { isConnected, portInfo, bytesRx, bytesTx, connect, disconnect, send, logs, clearLogs } =
    useWebSerial(handleSerialLine);

  // Auto-scroll console
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  // ─── Command senders ────────────────────────────────────────────────────────
  const sendSweep = () => {
    setSweepData([]);
    setMode('SWEEP');
    send(JSON.stringify({
      cmd: 'START_SWEEP',
      start_v: sweepCfg.start,
      stop_v: sweepCfg.stop,
      step_v: sweepCfg.step,
    }));
  };

  const sendAuto = () => {
    setMode('AUTO');
    send(JSON.stringify({ cmd: 'SET_MODE', mode: 'AUTO' }));
  };

  const sendCustomGain = () => {
    setSweepData([]);
    setMode('CUSTOM_GAIN');
    send(JSON.stringify({
      cmd: 'TEST_GAIN',
      input_mux_ch: gainInputCh,
      feedback_mux_ch: gainFbCh,
      bank: gainBank,
    }));
  };

  const sendManualRoute = () => {
    setMode('MANUAL');
    send(JSON.stringify({ cmd: 'MANUAL_ROUTE', mux: manualMux, ch: manualCh }));
  };

  const sendIdle = () => {
    setMode('IDLE');
    send(JSON.stringify({ cmd: 'SET_MODE', mode: 'IDLE' }));
  };

  const sendCalibrate = () => {
    setMode('CALIBRATION');
    send(JSON.stringify({ cmd: 'CALIBRATE', params: { bench_gain: calBenchGain } }));
  };

  const sendPing = () => send(JSON.stringify({ cmd: 'PING' }));

  // ─── CSV export ─────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const csv = sweepToCSV(sweepData);
    downloadString(csv, `sweep_${Date.now()}.csv`);
  };

  const exportJSON = () => {
    downloadString(JSON.stringify({ params, sweepData, config: sweepCfg }, null, 2), `bench_${Date.now()}.json`, 'application/json');
  };

  // ─── Chart data ─────────────────────────────────────────────────────────────
  const sweepChartData = {
    datasets: [
      {
        label: 'Vout vs Vin',
        data: sweepData.map(p => ({ x: p.vin, y: p.vout })),
        pointRadius: sweepData.length > 200 ? 2 : 4,
        pointHoverRadius: 6,
        borderColor: '#34d399',
        backgroundColor: 'rgba(52,211,153,0.15)',
        showLine: true,
        tension: 0.2,
        fill: false,
      },
      ...(computedGain && sweepData.length >= 2 ? [{
        label: `Linear fit (slope=${computedGain.slope.toFixed(3)}, R²=${computedGain.r2.toFixed(4)})`,
        data: [
          { x: sweepCfg.start, y: sweepCfg.start * computedGain.slope + computedGain.intercept },
          { x: sweepCfg.stop, y: sweepCfg.stop * computedGain.slope + computedGain.intercept },
        ],
        borderColor: '#f59e0b',
        backgroundColor: 'transparent',
        borderDash: [6, 3],
        pointRadius: 0,
        showLine: true,
        tension: 0,
      }] : []),
    ],
  };

  const gainChartData = {
    datasets: [{
      label: 'Gain (Vout/Vin)',
      data: sweepData
        .filter(p => Math.abs(p.vin) > 0.05)
        .map(p => ({ x: p.vin, y: p.vout / p.vin })),
      pointRadius: 3,
      borderColor: '#818cf8',
      backgroundColor: 'rgba(129,140,248,0.2)',
      showLine: true,
      tension: 0.2,
    }],
  };

  const chartOptions = (xLabel: string, yLabel: string) => ({
    animation: { duration: 0 },
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#94a3b8', font: { family: 'monospace', size: 10 } } },
      tooltip: {
        callbacks: {
          label: (ctx: any) => `${ctx.dataset.label}: (${ctx.parsed.x.toFixed(3)}, ${ctx.parsed.y.toFixed(3)})`,
        },
      },
    },
    scales: {
      x: {
        type: 'linear' as const,
        title: { display: true, text: xLabel, color: '#64748b', font: { family: 'monospace', size: 11 } },
        grid: { color: 'rgba(255,255,255,0.05)' },
        ticks: { color: '#64748b', font: { family: 'monospace', size: 10 } },
      },
      y: {
        title: { display: true, text: yLabel, color: '#64748b', font: { family: 'monospace', size: 11 } },
        grid: { color: 'rgba(255,255,255,0.05)' },
        ticks: { color: '#64748b', font: { family: 'monospace', size: 10 } },
      },
    },
  });

  // ─── Render ─────────────────────────────────────────────────────────────────
  const tabs: { id: Tab; label: string }[] = [
    { id: 'sweep', label: '📈 Sweep & Plot' },
    { id: 'gain', label: '🔁 Custom Gain' },
    { id: 'manual', label: '🔌 Manual Route' },
    { id: 'calibration', label: '⚙️ Calibration' },
    { id: 'pinmap', label: '📌 Pin Map' },
    { id: 'protocol', label: '📡 Protocol' },
  ];

  const modeColor = (m: SystemMode) =>
    mode === m ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300' : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500';

  const inputCls = 'bg-slate-800 border border-slate-700 text-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500 font-mono';
  const btnCls = (variant: 'primary' | 'secondary' | 'danger' | 'ghost' = 'primary') =>
    clsx(
      'text-xs font-bold uppercase px-4 py-2 rounded transition font-mono',
      variant === 'primary' && 'bg-emerald-600 hover:bg-emerald-500 text-white',
      variant === 'secondary' && 'bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600',
      variant === 'danger' && 'bg-rose-700 hover:bg-rose-600 text-white',
      variant === 'ghost' && 'border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200',
    );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 font-mono flex flex-col">
      {/* ── Header ── */}
      <header className="flex justify-between items-center border-b border-slate-800 px-6 py-3 bg-slate-950/80 backdrop-blur sticky top-0 z-10">
        <div>
          <h1 className="text-lg font-black tracking-wider text-emerald-400">
            AUTO_OPAMP_BENCH
            <span className="text-slate-600 ml-2 font-normal text-xs">// CONTROLLER v2.0</span>
          </h1>
          <p className="text-[10px] text-slate-500">CD74HC4067 5× MUX Matrix · ADS1115 16-bit ADC · Web Serial JSON-RPC</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Status pill */}
          <div className={clsx('flex items-center gap-2 text-xs px-3 py-1 rounded-full border',
            isConnected
              ? 'border-emerald-600 bg-emerald-600/10 text-emerald-400'
              : 'border-slate-700 bg-slate-900 text-slate-500')}>
            <span className={clsx('h-2 w-2 rounded-full', isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600')} />
            {isConnected ? (portInfo ?? 'CONNECTED') : 'DISCONNECTED'}
          </div>
          {/* Byte counters */}
          {isConnected && (
            <div className="text-[10px] text-slate-600 text-right leading-tight">
              <div>RX {bytesRx.toLocaleString()} B</div>
              <div>TX {bytesTx.toLocaleString()} B</div>
            </div>
          )}
          {/* Mode badge */}
          <span className="text-[10px] text-slate-600 border border-slate-800 rounded px-2 py-1">
            MODE: <span className="text-amber-400">{mode}</span>
          </span>
          {/* Connect/Disconnect */}
          {!isConnected ? (
            <button onClick={() => connect(115200)} className={btnCls('primary')}>
              Open Serial
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={sendPing} className={btnCls('ghost')}>PING</button>
              <button onClick={disconnect} className={btnCls('danger')}>Disconnect</button>
            </div>
          )}
        </div>
      </header>

      {/* ── Metrics Bar ── */}
      <section className="grid grid-cols-6 gap-3 px-6 py-4 border-b border-slate-800">
        <MetricCard label="Vos (Input Offset)" value={params.vos_mv?.toFixed(3)} unit="mV" color="text-amber-400" />
        <MetricCard label="Ib (Input Bias)" value={params.ib_na?.toFixed(1)} unit="nA" color="text-sky-400" />
        <MetricCard label="Aol (Open-Loop Gain)" value={params.aol_db?.toFixed(1)} unit="dB" color="text-violet-400" />
        <MetricCard label="CL Gain (Regression)" value={gainDB !== null ? gainDB.toFixed(2) : undefined} unit="dB"
          color="text-emerald-400" sub={computedGain ? `slope=${computedGain.slope.toFixed(4)} R²=${computedGain.r2.toFixed(4)}` : undefined} />
        <MetricCard label="Slew Rate (est.)" value={slewRate !== null && slewRate > 0 ? slewRate.toFixed(3) : undefined} unit="V/µs" color="text-rose-400" />
        <MetricCard label="Sweep Points" value={sweepData.length > 0 ? sweepData.length.toString() : undefined}
          color="text-slate-300" sub={sweepRunning ? '● acquiring...' : sweepData.length > 0 ? 'complete' : ''} />
      </section>

      {/* ── Quick-action mode buttons ── */}
      <section className="flex items-center gap-2 px-6 py-2 border-b border-slate-800 bg-slate-900/50">
        <span className="text-[10px] text-slate-600 mr-2">QUICK:</span>
        {(['AUTO', 'SWEEP', 'MANUAL', 'CALIBRATION', 'CUSTOM_GAIN', 'IDLE'] as SystemMode[]).map(m => (
          <button
            key={m}
            disabled={!isConnected}
            onClick={() => {
              if (m === 'AUTO') sendAuto();
              else if (m === 'SWEEP') sendSweep();
              else if (m === 'CUSTOM_GAIN') sendCustomGain();
              else if (m === 'CALIBRATION') sendCalibrate();
              else if (m === 'IDLE') sendIdle();
              else { setMode(m); send(JSON.stringify({ cmd: 'SET_MODE', mode: m })); }
            }}
            className={clsx('text-[10px] font-bold px-3 py-1 rounded border uppercase transition',
              modeColor(m), 'disabled:opacity-30 disabled:cursor-not-allowed')}
          >
            {m}
          </button>
        ))}
      </section>

      {/* ── Main layout: Tabs + Console ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left column: Tabs */}
        <div className="flex-1 flex flex-col overflow-auto">
          {/* Tab bar */}
          <div className="flex border-b border-slate-800 px-6 pt-3 gap-1">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={clsx('text-[11px] font-bold px-4 py-2 rounded-t border-b-2 transition',
                  activeTab === t.id
                    ? 'border-emerald-500 text-emerald-300 bg-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-300')}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-auto p-6">

            {/* ── TAB: Sweep & Plot ── */}
            {activeTab === 'sweep' && (
              <div className="space-y-6">
                <SectionHeader title="Sweep Configuration" />
                <div className="flex gap-4 items-end flex-wrap">
                  {(['start', 'stop', 'step'] as const).map(k => (
                    <div key={k}>
                      <label className="block text-[10px] text-slate-500 mb-1 uppercase">{k} (V)</label>
                      <input
                        type="number"
                        className={inputCls + ' w-24'}
                        step={k === 'step' ? 0.005 : 0.1}
                        min={0} max={5}
                        value={sweepCfg[k]}
                        onChange={e => setSweepCfg(prev => ({ ...prev, [k]: parseFloat(e.target.value) || 0 }))}
                      />
                    </div>
                  ))}
                  <div className="text-[10px] text-slate-600 leading-relaxed">
                    {Math.ceil((sweepCfg.stop - sweepCfg.start) / sweepCfg.step)} pts<br />
                    ~{(Math.ceil((sweepCfg.stop - sweepCfg.start) / sweepCfg.step) * 10 / 1000).toFixed(1)}s est.
                  </div>
                  <button disabled={!isConnected || sweepRunning} onClick={sendSweep} className={btnCls('primary')}>
                    {sweepRunning ? '⏳ Running…' : '▶ Run Sweep'}
                  </button>
                  <button disabled={sweepData.length === 0} onClick={() => setSweepData([])} className={btnCls('ghost')}>
                    ✕ Clear
                  </button>
                  <button disabled={sweepData.length === 0} onClick={exportCSV} className={btnCls('secondary')}>
                    ⬇ CSV
                  </button>
                  <button disabled={sweepData.length === 0} onClick={exportJSON} className={btnCls('secondary')}>
                    ⬇ JSON
                  </button>
                </div>

                {/* Transfer curve chart */}
                <SectionHeader title="Transfer Curve" badge={`${sweepData.length} pts`} />
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 h-80">
                  {sweepData.length > 0 ? (
                    <Scatter data={sweepChartData} options={chartOptions('Vin (V)', 'Vout (V)')} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-700 text-sm">
                      No data — run a sweep to populate the chart
                    </div>
                  )}
                </div>

                {/* Gain flatness chart */}
                <SectionHeader title="Gain vs Vin" badge="closed-loop" />
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 h-64">
                  {sweepData.filter(p => Math.abs(p.vin) > 0.05).length > 0 ? (
                    <Scatter data={gainChartData} options={chartOptions('Vin (V)', 'Gain (Vout/Vin)')} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-700 text-sm">
                      Gain profile will appear after sweep
                    </div>
                  )}
                </div>

                {/* Last 5 data rows */}
                {sweepData.length > 0 && (
                  <div>
                    <SectionHeader title="Recent Points" badge={`last 8 of ${sweepData.length}`} />
                    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="border-b border-slate-800 text-slate-500">
                            <th className="p-2 text-left">#</th>
                            <th className="p-2 text-right">Vin (V)</th>
                            <th className="p-2 text-right">Vout (V)</th>
                            <th className="p-2 text-right">Gain</th>
                            <th className="p-2 text-right">Gain (dB)</th>
                            <th className="p-2 text-right">t (ms)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sweepData.slice(-8).map((pt, i) => {
                            const gain = Math.abs(pt.vin) > 0.01 ? pt.vout / pt.vin : null;
                            return (
                              <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                                <td className="p-2 text-slate-600">{sweepData.length - 8 + i + 1}</td>
                                <td className="p-2 text-right text-sky-400">{pt.vin.toFixed(4)}</td>
                                <td className="p-2 text-right text-emerald-400">{pt.vout.toFixed(4)}</td>
                                <td className="p-2 text-right text-amber-400">{gain !== null ? gain.toFixed(4) : '—'}</td>
                                <td className="p-2 text-right text-violet-400">{gain !== null ? gainTodB(gain).toFixed(2) : '—'}</td>
                                <td className="p-2 text-right text-slate-600">{pt.timestamp ?? '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── TAB: Custom Gain ── */}
            {activeTab === 'gain' && (
              <div className="space-y-6">
                <SectionHeader title="Programmable Gain Matrix" />
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Select an input signal source and a feedback resistor network via the MUX matrix. The firmware
                  routes signals through CD74HC4067 banks and measures closed-loop gain from Vout/Vin.
                </p>

                <div className="grid grid-cols-2 gap-6">
                  {/* Input source */}
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Input Signal Source</h3>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-1 uppercase">MUX Bank</label>
                      <div className="flex gap-2">
                        {(['A', 'B'] as const).map(b => (
                          <button key={b} onClick={() => setGainBank(b)}
                            className={clsx('text-xs px-4 py-1.5 rounded border font-bold transition',
                              gainBank === b ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                                : 'border-slate-700 text-slate-500 hover:border-slate-500'
                            )}>
                            Bank {b} {b === 'A' ? '(Page 2)' : '(Page 4)'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-1 uppercase">Channel</label>
                      <select value={gainInputCh} onChange={e => setGainInputCh(Number(e.target.value))} className={inputCls + ' w-full'}>
                        {(gainBank === 'A' ? INPUT_MUX_CHANNELS_A : INPUT_MUX_CHANNELS_B).map(ch => (
                          <option key={ch.ch} value={ch.ch}>
                            CH{ch.ch} — {ch.label}: {ch.description}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Feedback resistor */}
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Feedback Resistor (MUX_U10)</h3>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-1 uppercase">Feedback Network</label>
                      <select value={gainFbCh} onChange={e => setGainFbCh(Number(e.target.value))} className={inputCls + ' w-full'}>
                        {FEEDBACK_MUX_CHANNELS.slice(0, 8).map(ch => (
                          <option key={ch.ch} value={ch.ch}>
                            CH{ch.ch} — {ch.label} (est. ×{ch.gain_approx.toFixed(1)})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="text-[10px] text-slate-500 bg-slate-800/50 rounded p-2">
                      Selected feedback: CH{gainFbCh}<br />
                      Approx. gain: ×{FEEDBACK_MUX_CHANNELS[gainFbCh]?.gain_approx.toFixed(1) ?? '?'}
                      {' = '}{gainTodB(FEEDBACK_MUX_CHANNELS[gainFbCh]?.gain_approx ?? 1).toFixed(1)} dB
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button disabled={!isConnected || sweepRunning} onClick={sendCustomGain} className={btnCls('primary')}>
                    {sweepRunning ? '⏳ Acquiring…' : '▶ Run Gain Test'}
                  </button>
                  <button disabled={sweepData.length === 0} onClick={() => setSweepData([])} className={btnCls('ghost')}>
                    ✕ Clear Results
                  </button>
                  <button disabled={sweepData.length === 0} onClick={exportCSV} className={btnCls('secondary')}>
                    ⬇ Export CSV
                  </button>
                </div>

                {/* Results chart */}
                {sweepData.length > 0 && (
                  <>
                    <SectionHeader title="Gain Test Results" badge={`Bank ${gainBank} CH${gainInputCh} → FB CH${gainFbCh}`} />
                    <div className="bg-slate-900 border border-emerald-500/20 rounded-lg p-4 h-72">
                      <Scatter data={sweepChartData} options={chartOptions('Vin (V)', 'Vout (V)')} />
                    </div>
                    {computedGain && (
                      <div className="grid grid-cols-4 gap-3">
                        <MetricCard label="CL Gain (slope)" value={computedGain.slope.toFixed(4)} color="text-emerald-400" />
                        <MetricCard label="Gain (dB)" value={gainTodB(computedGain.slope).toFixed(2)} unit="dB" color="text-violet-400" />
                        <MetricCard label="Offset (intercept)" value={computedGain.intercept.toFixed(4)} unit="V" color="text-amber-400" />
                        <MetricCard label="Linearity (R²)" value={computedGain.r2.toFixed(5)} color={computedGain.r2 > 0.999 ? 'text-emerald-400' : 'text-rose-400'} />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── TAB: Manual Route ── */}
            {activeTab === 'manual' && (
              <div className="space-y-6">
                <SectionHeader title="Manual MUX Routing" />
                <p className="text-[11px] text-slate-500">
                  Directly set a specific CD74HC4067 instance to a given channel for probing and debug.
                  Puts the system into MANUAL mode.
                </p>
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-1 uppercase">MUX Instance</label>
                      <select value={manualMux} onChange={e => setManualMux(e.target.value as any)} className={inputCls + ' w-full'}>
                        <option value="U4">U4 — Input MUX A (Page 2, Pins 2–5)</option>
                        <option value="U6">U6 — Attenuator MUX A (Page 2, Pins 6–9)</option>
                        <option value="U7">U7 — Input MUX B (Page 4, Pins 10–13)</option>
                        <option value="U8">U8 — Attenuator MUX B (Page 4, Pins 14–17)</option>
                        <option value="U10">U10 — Output Feedback MUX (Page 5, Pins 18–21)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-1 uppercase">Channel (0–15)</label>
                      <input
                        type="number" min={0} max={15} value={manualCh}
                        onChange={e => setManualCh(Math.min(15, Math.max(0, parseInt(e.target.value) || 0)))}
                        className={inputCls + ' w-full'}
                      />
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button disabled={!isConnected} onClick={sendManualRoute} className={btnCls('primary')}>
                      ↳ Route {manualMux} → CH{manualCh}
                    </button>
                    <button disabled={!isConnected} onClick={sendIdle} className={btnCls('ghost')}>
                      → IDLE (release)
                    </button>
                  </div>
                  <div className="text-[10px] text-slate-600 bg-slate-800/40 rounded p-2 font-mono">
                    → <span className="text-amber-400">{'{'}"cmd":"MANUAL_ROUTE","mux":"{manualMux}","ch":{manualCh}{'}'}</span>
                  </div>
                </div>

                {/* MUX channel quick-picker matrix */}
                <SectionHeader title="Quick Channel Matrix" />
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                  <div className="grid grid-cols-8 gap-2">
                    {Array.from({ length: 16 }, (_, i) => (
                      <button
                        key={i}
                        disabled={!isConnected}
                        onClick={() => {
                          setManualCh(i);
                          send(JSON.stringify({ cmd: 'MANUAL_ROUTE', mux: manualMux, ch: i }));
                        }}
                        className={clsx(
                          'text-[10px] font-bold p-2 rounded border transition',
                          manualCh === i
                            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                            : 'bg-slate-800 border-slate-700 text-slate-500 hover:border-slate-500',
                          'disabled:opacity-30'
                        )}
                      >
                        CH{i}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── TAB: Calibration ── */}
            {activeTab === 'calibration' && (
              <div className="space-y-6">
                <SectionHeader title="Calibration & Parameters" />
                <div className="grid grid-cols-2 gap-6">
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
                    <h3 className="text-xs font-bold text-slate-300 uppercase">Test-Bench Parameters</h3>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-1 uppercase">Bench Closed-Loop Gain (×)</label>
                      <input
                        type="number" min={1} max={10000} value={calBenchGain}
                        onChange={e => setCalBenchGain(parseInt(e.target.value) || 100)}
                        className={inputCls + ' w-full'}
                      />
                      <p className="text-[10px] text-slate-600 mt-1">
                        Used to back-calculate Vos from measured differential output.
                        Vos = V_diff / gain.
                      </p>
                    </div>
                    <button disabled={!isConnected} onClick={sendCalibrate} className={btnCls('primary')}>
                      ⚙ Send Calibration Config
                    </button>
                  </div>

                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-3">
                    <h3 className="text-xs font-bold text-slate-300 uppercase">Extracted Parameters (Live)</h3>
                    {([ ['Vos', params.vos_mv, 'mV', 'Input Offset Voltage'],
                        ['Ib', params.ib_na, 'nA', 'Input Bias Current'],
                        ['Aol', params.aol_db, 'dB', 'Open Loop Gain'],
                        ['CMRR', params.cmrr_db, 'dB', 'Common Mode Rejection'],
                        ['PSRR', params.psrr_db, 'dB', 'Power Supply Rejection'],
                        ['BW', params.bandwidth_khz, 'kHz', 'Bandwidth'],
                    ] as [string, number | undefined, string, string][]).map(([k, v, u, desc]) => (
                      <div key={k} className="flex justify-between items-center border-b border-slate-800 pb-2">
                        <div>
                          <span className="text-slate-300 text-xs font-bold">{k}</span>
                          <span className="text-slate-600 text-[10px] ml-2">{desc}</span>
                        </div>
                        <span className={clsx('font-black font-mono text-sm', v !== undefined ? 'text-amber-400' : 'text-slate-700')}>
                          {v !== undefined ? `${v.toFixed(3)} ${u}` : '---'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <SectionHeader title="Automated Routine" />
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                  <p className="text-[11px] text-slate-500 mb-3">
                    Runs the full automated parametric extraction: zero-differential baseline → Vos → Ib → Aol.
                    Ensure DUT is biased and bench power supply is stable before running.
                  </p>
                  <button disabled={!isConnected} onClick={sendAuto} className={btnCls('primary')}>
                    ▶ Run Full AUTO Extraction
                  </button>
                </div>
              </div>
            )}

            {/* ── TAB: Pin Map ── */}
            {activeTab === 'pinmap' && (
              <div className="space-y-6">
                <SectionHeader title="Hardware Pin Map (from Schematic)" />

                {/* Page 2 */}
                <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                  <div className="bg-slate-800/50 px-4 py-2 border-b border-slate-800">
                    <span className="text-xs font-bold text-sky-400">PAGE 2 — Input MUX A (U4) + Attenuator MUX A (U6)</span>
                  </div>
                  <table className="w-full text-[11px]">
                    <thead><tr className="border-b border-slate-800 text-slate-500">
                      <th className="p-3 text-left">Signal</th><th className="p-3 text-left">Arduino Pin</th><th className="p-3 text-left">Role</th>
                    </tr></thead>
                    <tbody>
                      {[
                        ['Intermediate Voltage 1', 'Pin 2', '3.3V voltage divider reference'],
                        ['Intermediate Voltage 2', 'Pin 3', '2.5V voltage divider reference'],
                        ['Function Generator', 'External', 'Stimulus input signal'],
                        ['Arduino Custom Signal', 'Pin 10', 'Firmware-generated signal'],
                        ['Custom Output', 'External', 'User-routed external signal'],
                        ['S0 L', 'Pin 11', 'MUX select bit 0, left bank'],
                        ['S1 L', 'Pin 12', 'MUX select bit 1, left bank'],
                        ['S2 L', 'Pin 13', 'MUX select bit 2, left bank'],
                        ['S0 R', 'Pin 14', 'MUX select bit 0, right bank'],
                        ['S1 R', 'Pin 15', 'MUX select bit 1, right bank'],
                        ['S2 R', 'Pin 16', 'MUX select bit 2, right bank'],
                      ].map(([sig, pin, role]) => (
                        <tr key={sig} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="p-3 text-slate-200 font-bold">{sig}</td>
                          <td className="p-3 text-emerald-400 font-mono">{pin}</td>
                          <td className="p-3 text-slate-500">{role}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Page 4 */}
                <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                  <div className="bg-slate-800/50 px-4 py-2 border-b border-slate-800">
                    <span className="text-xs font-bold text-violet-400">PAGE 4 — Input MUX B (U7) + Attenuator MUX B (U8)</span>
                  </div>
                  <table className="w-full text-[11px]">
                    <thead><tr className="border-b border-slate-800 text-slate-500">
                      <th className="p-3 text-left">Signal</th><th className="p-3 text-left">Arduino Pin</th><th className="p-3 text-left">Role</th>
                    </tr></thead>
                    <tbody>
                      {[
                        ['Intermediate Voltage 1', 'Pin 2 (Ext)', '3.3V divider – extended routing'],
                        ['Intermediate Voltage 2', 'Pin 3 (Ext)', '2.5V divider – extended routing'],
                        ['Function Generator', 'External', 'Stimulus input signal'],
                        ['Arduino Custom Signal', 'Pin 17', 'Firmware-generated signal B'],
                        ['Custom Output', 'External', 'User-routed external pin'],
                        ['S0 L', 'Pin 18', 'MUX select bit 0, left bank'],
                        ['S1 L', 'Pin 19', 'MUX select bit 1, left bank'],
                        ['S2 L', 'Pin 20', 'MUX select bit 2, left bank'],
                        ['S0 R', 'Pin 21', 'MUX select bit 0, right bank'],
                        ['S1 R', 'Pin 22', 'MUX select bit 1, right bank'],
                        ['S2 R', 'Pin 23', 'MUX select bit 2, right bank'],
                      ].map(([sig, pin, role]) => (
                        <tr key={sig} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="p-3 text-slate-200 font-bold">{sig}</td>
                          <td className="p-3 text-violet-400 font-mono">{pin}</td>
                          <td className="p-3 text-slate-500">{role}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Page 5 */}
                <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                  <div className="bg-slate-800/50 px-4 py-2 border-b border-slate-800">
                    <span className="text-xs font-bold text-amber-400">PAGE 5 — Voltage Gen / Attenuator MUX (3-bank)</span>
                  </div>
                  <table className="w-full text-[11px]">
                    <thead><tr className="border-b border-slate-800 text-slate-500">
                      <th className="p-3 text-left">Signal</th><th className="p-3 text-left">Arduino Pin</th><th className="p-3 text-left">Role</th>
                    </tr></thead>
                    <tbody>
                      {[
                        ['Voltage Gen Att 1', 'MUX output', 'Attenuated voltage generator output 1'],
                        ['Voltage Gen Att 2', 'TBD', 'Attenuated voltage generator output 2'],
                        ['S0 L', 'Pin 24', 'Left bank select bit 0'],
                        ['S1 L', 'Pin 25', 'Left bank select bit 1'],
                        ['S2 L', 'Pin 26', 'Left bank select bit 2'],
                        ['S0 M', 'Pin 27', 'Mid bank select bit 0'],
                        ['S1 M', 'Pin 28', 'Mid bank select bit 1'],
                        ['S2 M', 'Pin 29', 'Mid bank select bit 2'],
                        ['S0 R', 'Pin 30', 'Right bank select bit 0'],
                        ['S1 R', 'Pin 31', 'Right bank select bit 1'],
                        ['S2 R', 'Pin 32', 'Right bank select bit 2'],
                      ].map(([sig, pin, role]) => (
                        <tr key={sig} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="p-3 text-slate-200 font-bold">{sig}</td>
                          <td className="p-3 text-amber-400 font-mono">{pin}</td>
                          <td className="p-3 text-slate-500">{role}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── TAB: Protocol ── */}
            {activeTab === 'protocol' && (
              <div className="space-y-6">
                <SectionHeader title="Serial Protocol Reference" />
                <p className="text-[11px] text-slate-500">
                  All communication is newline-delimited JSON over USB CDC UART at 115200 baud 8N1.
                </p>

                <div className="space-y-4">
                  {[
                    {
                      dir: 'TX → MCU', color: 'text-sky-400', cmds: [
                        ['SET_MODE', '{"cmd":"SET_MODE","mode":"AUTO"|"IDLE"|"MANUAL"|"CALIBRATION"}', 'Switch operating mode'],
                        ['START_SWEEP', '{"cmd":"START_SWEEP","start_v":0,"stop_v":4.5,"step_v":0.05}', 'Begin transfer sweep'],
                        ['TEST_GAIN', '{"cmd":"TEST_GAIN","input_mux_ch":2,"feedback_mux_ch":0,"bank":"A"}', 'Programmable gain test'],
                        ['MANUAL_ROUTE', '{"cmd":"MANUAL_ROUTE","mux":"U4","ch":3}', 'Route specific MUX directly'],
                        ['CALIBRATE', '{"cmd":"CALIBRATE","params":{"bench_gain":100}}', 'Send bench calibration params'],
                        ['PING', '{"cmd":"PING"}', 'Liveness check'],
                      ]
                    },
                    {
                      dir: 'RX ← MCU', color: 'text-emerald-400', cmds: [
                        ['READY', '{"status":"READY","system":"OPAMP_TESTBENCH_V1"}', 'Boot handshake'],
                        ['ACK', '{"ack":true,"mode_set":true}', 'Command acknowledgement'],
                        ['PARAM_DATA', '{"event":"PARAM_DATA","vos_mv":0.024,"ib_na":12.5,"aol_db":92.0}', 'Extracted parameters'],
                        ['SWEEP_POINT', '{"vin":0.500,"vout":0.505}', 'Individual transfer curve point'],
                        ['SWEEP_START', '{"event":"SWEEP_START"}', 'Sweep begin marker'],
                        ['SWEEP_COMPLETE', '{"event":"SWEEP_COMPLETE"}', 'Sweep end marker'],
                        ['AUTO_COMPLETE', '{"event":"AUTO_COMPLETE"}', 'Automated routine complete'],
                        ['PONG', '{"event":"PONG","uptime_ms":12345}', 'Ping response with uptime'],
                      ]
                    }
                  ].map(section => (
                    <div key={section.dir} className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                      <div className="bg-slate-800/50 px-4 py-2 border-b border-slate-800">
                        <span className={`text-xs font-bold ${section.color}`}>{section.dir}</span>
                      </div>
                      <table className="w-full text-[11px]">
                        <thead><tr className="border-b border-slate-800 text-slate-600">
                          <th className="p-3 text-left">Command</th><th className="p-3 text-left">Payload</th><th className="p-3 text-left">Description</th>
                        </tr></thead>
                        <tbody>
                          {section.cmds.map(([cmd, payload, desc]) => (
                            <tr key={cmd} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                              <td className={`p-3 font-bold ${section.color}`}>{cmd}</td>
                              <td className="p-3 text-slate-400 font-mono text-[10px]">{payload}</td>
                              <td className="p-3 text-slate-600">{desc}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right column: Serial console ── */}
        <div className="w-96 flex flex-col border-l border-slate-800 bg-slate-950">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/50">
            <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Serial Console</span>
            <div className="flex gap-2">
              <span className="text-[10px] text-slate-600">{logs.length} lines</span>
              <button onClick={clearLogs} className="text-[10px] text-slate-600 hover:text-slate-400 transition">✕ Clear</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-0.5 text-[10px] font-mono">
            {logs.map(log => {
              const tsStr = formatTs(log.ts % 86400000);
              const color = log.type === 'tx' ? 'text-sky-400'
                : log.type === 'error' ? 'text-rose-400'
                : log.type === 'system' ? 'text-amber-400/70'
                : 'text-slate-400';
              const prefix = log.type === 'tx' ? '→' : log.type === 'rx' ? '←' : log.type === 'error' ? '✕' : '·';
              return (
                <div key={log.id} className={`flex gap-2 leading-relaxed ${color}`}>
                  <span className="text-slate-700 shrink-0">{tsStr}</span>
                  <span className="shrink-0">{prefix}</span>
                  <span className="break-all">{log.raw}</span>
                </div>
              );
            })}
            <div ref={consoleEndRef} />
          </div>
          {/* Manual send */}
          <div className="p-3 border-t border-slate-800">
            <ManualSendBox onSend={send} disabled={!isConnected} />
          </div>
        </div>
      </div>
    </main>
  );
}

// ─── Manual Send Box Component ─────────────────────────────────────────────────
function ManualSendBox({ onSend, disabled }: { onSend: (s: string) => void; disabled: boolean }) {
  const [val, setVal] = useState('');
  const submit = () => {
    const trimmed = val.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setVal('');
  };
  return (
    <div className="flex gap-2">
      <input
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && !disabled && submit()}
        placeholder='{"cmd":"PING"}'
        disabled={disabled}
        className="flex-1 bg-slate-900 border border-slate-700 text-slate-200 rounded px-2 py-1.5 text-[10px] font-mono focus:outline-none focus:border-emerald-500 disabled:opacity-30"
      />
      <button
        onClick={submit}
        disabled={disabled || !val.trim()}
        className="text-[10px] font-bold px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded disabled:opacity-30 transition"
      >
        Send
      </button>
    </div>
  );
}
