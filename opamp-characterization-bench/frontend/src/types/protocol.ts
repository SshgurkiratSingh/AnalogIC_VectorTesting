// ─── System Modes ────────────────────────────────────────────────────────────
export type SystemMode = 'IDLE' | 'AUTO' | 'MANUAL' | 'SWEEP' | 'CALIBRATION' | 'CUSTOM_GAIN';

// ─── Commands (Host → MCU) ───────────────────────────────────────────────────
export interface CommandPacket {
  cmd: 'SET_MODE' | 'MANUAL_ROUTE' | 'START_SWEEP' | 'READ_ADC' | 'TEST_GAIN' | 'CALIBRATE' | 'PING';
  mode?: SystemMode;
  mux?: string;
  ch?: number;
  input_mux_ch?: number;
  feedback_mux_ch?: number;
  start_v?: number;
  stop_v?: number;
  step_v?: number;
  params?: Record<string, number>;
}

// ─── Telemetry Frames (MCU → Host) ───────────────────────────────────────────
export interface SweepPoint {
  vin: number;
  vout: number;
  gain?: number;       // computed: vout/vin
  timestamp?: number;  // ms since sweep start
}

export interface ExtractedParameters {
  vos_mv?: number;
  ib_na?: number;
  aol_db?: number;
  slew_rate_v_us?: number;
  cmrr_db?: number;
  psrr_db?: number;
  bandwidth_khz?: number;
}

// ─── Hardware Channel Maps (from schematic) ───────────────────────────────────

/** Input MUX channels per schematic Page 2 (U4) */
export interface MuxChannel {
  ch: number;
  label: string;
  description: string;
  group: 'signal' | 'reference' | 'custom';
}

export const INPUT_MUX_CHANNELS_A: MuxChannel[] = [
  { ch: 0, label: 'INTVOL_1', description: 'Intermediate Voltage 1 – 3.3V divider (Pin 2)', group: 'reference' },
  { ch: 1, label: 'INTVOL_2', description: 'Intermediate Voltage 2 – 2.5V divider (Pin 3)', group: 'reference' },
  { ch: 2, label: 'FUNC_GEN', description: 'Function Generator – External Pin', group: 'signal' },
  { ch: 3, label: 'ARD_SIG', description: 'Arduino Custom Signal (Pin 10)', group: 'custom' },
  { ch: 4, label: 'CUST_OUT', description: 'Custom Output – External Input', group: 'custom' },
];

/** Page 2 MUX select line pins */
export const MUX_PAGE2_PINS = {
  S0_L: 11, S1_L: 12, S2_L: 13,
  S0_R: 14, S1_R: 15, S2_R: 16,
};

/** Page 4 – Extended Input MUX channels (U7) */
export const INPUT_MUX_CHANNELS_B: MuxChannel[] = [
  { ch: 0, label: 'INTVOL_1_EXT', description: 'Intermediate Voltage 1 – Pin 2 Extended', group: 'reference' },
  { ch: 1, label: 'INTVOL_2_EXT', description: 'Intermediate Voltage 2 – Pin 3 Extended', group: 'reference' },
  { ch: 2, label: 'FUNC_GEN_B', description: 'Function Generator – External Pin', group: 'signal' },
  { ch: 3, label: 'ARD_SIG_B', description: 'Arduino Custom Signal (Pin 17)', group: 'custom' },
  { ch: 4, label: 'CUST_OUT_B', description: 'Custom Output – External Pin', group: 'custom' },
];

/** Page 4 MUX select line pins */
export const MUX_PAGE4_PINS = {
  S0_L: 18, S1_L: 19, S2_L: 20,
  S0_R: 21, S1_R: 22, S2_R: 23,
};

/** Page 5 – Voltage Generator / Attenuator MUX select lines */
export const MUX_PAGE5_PINS = {
  S0_L: 24, S1_L: 25, S2_L: 26,
  S0_M: 27, S1_M: 28, S2_M: 29,
  S0_R: 30, S1_R: 31, S2_R: 32,
};

export const FEEDBACK_MUX_CHANNELS = Array.from({ length: 16 }, (_, i) => ({
  ch: i,
  label: `R_NET_${i}`,
  description: `Resistor Network ${i} – Feedback path`,
  gain_approx: 1 + i * 0.5,
}));

// ─── Log Entries ──────────────────────────────────────────────────────────────
export interface LogEntry {
  id: number;
  ts: number;    // Date.now()
  raw: string;
  parsed?: Record<string, unknown>;
  type: 'rx' | 'tx' | 'system' | 'error';
}
