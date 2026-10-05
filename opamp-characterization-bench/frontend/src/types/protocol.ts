export type SystemMode = 'IDLE' | 'AUTO' | 'MANUAL' | 'SWEEP' | 'CALIBRATION' | 'CUSTOM_GAIN';

export interface CommandPacket {
  cmd: 'SET_MODE' | 'MANUAL_ROUTE' | 'START_SWEEP' | 'READ_ADC' | 'TEST_GAIN';
  mode?: SystemMode;
  mux?: string;
  ch?: number;
  input_mux_ch?: number;
  feedback_mux_ch?: number;
  params?: Record<string, number>;
}

export interface SweepPoint {
  vin: number;
  vout: number;
}

export interface ExtractedParameters {
  vos_mv?: number;
  ib_na?: number;
  aol_db?: number;
  slew_rate_v_us?: number;
}
