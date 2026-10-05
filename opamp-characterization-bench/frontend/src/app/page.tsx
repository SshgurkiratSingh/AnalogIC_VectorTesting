'use client';
import React, { useState, useCallback } from 'react';
import { useWebSerial } from '@/hooks/useWebSerial';
import { SystemMode, SweepPoint, ExtractedParameters } from '@/types/protocol';

export default function BenchDashboard() {
  const [mode, setMode] = useState<SystemMode>('IDLE');
  const [params, setParams] = useState<ExtractedParameters>({});
  const [sweepData, setSweepData] = useState<SweepPoint[]>([]);
  const [consoleLog, setConsoleLog] = useState<string[]>([]);
  
  // Custom Gain state
  const [customGainInputCh, setCustomGainInputCh] = useState<number>(4); // Default to FunctionGenerator (4)
  const [customGainFbCh, setCustomGainFbCh] = useState<number>(2); // Default to some feedback channel

  const handleSerialLine = useCallback((line: string) => {
    setConsoleLog((prev) => [...prev.slice(-30), line]);
    try {
      const parsed = JSON.parse(line);
      if (parsed.event === 'PARAM_DATA') {
        setParams((prev) => ({ ...prev, vos_mv: parsed.vos_mv }));
      } else if (parsed.vin !== undefined && parsed.vout !== undefined) {
        setSweepData((prev) => [...prev, { vin: parsed.vin, vout: parsed.vout }]);
      }
    } catch {
      // Non-JSON logging
    }
  }, []);

  const { isConnected, connect, disconnect, send } = useWebSerial(handleSerialLine);

  const triggerMode = (newMode: SystemMode) => {
    setMode(newMode);
    if (newMode === 'AUTO') {
      send(JSON.stringify({ cmd: 'SET_MODE', mode: 'AUTO' }));
    } else if (newMode === 'SWEEP') {
      setSweepData([]);
      send(JSON.stringify({ cmd: 'START_SWEEP' }));
    } else if (newMode === 'CUSTOM_GAIN') {
      setSweepData([]);
      send(JSON.stringify({ 
        cmd: 'TEST_GAIN', 
        input_mux_ch: customGainInputCh, 
        feedback_mux_ch: customGainFbCh 
      }));
    } else {
      send(JSON.stringify({ cmd: 'SET_MODE', mode: newMode }));
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 font-mono">
      {/* Header Bar */}
      <header className="flex justify-between items-center border-b border-slate-800 pb-4 mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-wider text-emerald-400">
            AUTO_OPAMP_BENCH // CONTROLLER
          </h1>
          <p className="text-xs text-slate-500">Dual CD74HC4067 Matrix & ADS1115 Extraction Station</p>
        </div>
        <div>
          {!isConnected ? (
            <button
              onClick={() => connect(115200)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-4 py-2 rounded font-bold uppercase transition"
            >
              Open Serial Interface
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
              <button
                onClick={disconnect}
                className="bg-rose-700 hover:bg-rose-600 text-white text-xs px-4 py-2 rounded font-bold uppercase transition"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Control Navigation */}
      <section className="grid grid-cols-5 gap-4 mb-6">
        {(['AUTO', 'SWEEP', 'MANUAL', 'CALIBRATION', 'CUSTOM_GAIN'] as SystemMode[]).map((targetMode) => (
          <button
            key={targetMode}
            disabled={!isConnected}
            onClick={() => triggerMode(targetMode)}
            className={`p-3 text-xs font-bold border rounded transition uppercase ${
              mode === targetMode
                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                : 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-400'
            } disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            Mode: {targetMode}
          </button>
        ))}
      </section>

      {/* Custom Gain Configuration Panel */}
      {mode === 'CUSTOM_GAIN' && (
        <section className="bg-slate-900 border border-emerald-500/30 p-4 rounded mb-6">
          <h2 className="text-sm font-bold text-emerald-400 mb-4 uppercase">Custom Gain Configuration</h2>
          <div className="flex gap-6 items-end">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Input Signal MUX Channel</label>
              <select 
                value={customGainInputCh} 
                onChange={(e) => setCustomGainInputCh(Number(e.target.value))}
                className="bg-slate-800 border border-slate-700 text-slate-200 rounded p-2 text-sm"
              >
                <option value={2}>CH 2 - IntermediateVOI3</option>
                <option value={3}>CH 3 - IntermediateVOI1</option>
                <option value={4}>CH 4 - FunctionGenerator</option>
                <option value={5}>CH 5 - GND</option>
                <option value={6}>CH 6 - +5V</option>
                <option value={7}>CH 7 - ArduinoCustomSignal</option>
                <option value={9}>CH 9 - CustomInputExternal</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Feedback Gain MUX Channel</label>
              <select 
                value={customGainFbCh} 
                onChange={(e) => setCustomGainFbCh(Number(e.target.value))}
                className="bg-slate-800 border border-slate-700 text-slate-200 rounded p-2 text-sm"
              >
                {[...Array(8)].map((_, i) => (
                  <option key={i+2} value={i+2}>CH {i+2} - Resistor Network {i+1}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => triggerMode('CUSTOM_GAIN')}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-6 py-2 h-[38px] rounded font-bold uppercase transition"
            >
              Run Test
            </button>
          </div>
        </section>
      )}

      {/* Metrics & Extracted Values */}
      <section className="grid grid-cols-3 gap-6 mb-6">
        <div className="bg-slate-900 border border-slate-800 p-4 rounded">
          <span className="text-slate-500 text-xs tracking-widest block uppercase">Input Offset ({"$V_{OS}$"})</span>
          <span className="text-2xl font-black text-amber-400">
            {params.vos_mv !== undefined ? `${params.vos_mv.toFixed(3)} mV` : '---'}
          </span>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-4 rounded">
          <span className="text-slate-500 text-xs tracking-widest block uppercase">Input Bias ($I_B$)</span>
          <span className="text-2xl font-black text-amber-400">
            {params.ib_na !== undefined ? `${params.ib_na.toFixed(1)} nA` : '---'}
          </span>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-4 rounded">
          <span className="text-slate-500 text-xs tracking-widest block uppercase">Open Loop Gain ({"$A_{OL}$"})</span>
          <span className="text-2xl font-black text-amber-400">
            {params.aol_db !== undefined ? `${params.aol_db.toFixed(1)} dB` : '---'}
          </span>
        </div>
      </section>

      {/* Data Visualizer & Telemetry Feed */}
      <section className="grid grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 p-4 rounded h-64 overflow-y-auto">
          <h2 className="text-xs uppercase text-slate-400 mb-2 border-b border-slate-800 pb-1">
            Raw Telemetry Stream
          </h2>
          <pre className="text-[10px] text-slate-400 space-y-1">
            {consoleLog.map((log, idx) => (
              <div key={idx}>{log}</div>
            ))}
          </pre>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-4 rounded h-64">
          <h2 className="text-xs uppercase text-slate-400 mb-2 border-b border-slate-800 pb-1">
            Transfer Sweep Graph ({"$V_{IN}$"} vs {"$V_{OUT}$"})
          </h2>
          <div className="text-[10px] text-slate-500">
            Points Captured: {sweepData.length}
            {sweepData.slice(-5).map((pt, i) => (
              <div key={i} className="text-slate-300">
                IN: {pt.vin.toFixed(3)}V → OUT: {pt.vout.toFixed(3)}V
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
