# AnalogIC VectorTesting & Op-Amp Characterization Bench

[![Next.js 16](https://img.shields.io/badge/Frontend-Next.js%2016-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/UI-React%2019-61dafb?style=for-the-badge&logo=react)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Styling-Tailwind%20CSS-38bdf8?style=for-the-badge&logo=tailwindcss)](https://tailwindcss.com/)
[![C++](https://img.shields.io/badge/Firmware-C%2B%2B%20%2F%20Embedded-00599c?style=for-the-badge&logo=c%2B%2B)](https://isocpp.org/)
[![Web Serial API](https://img.shields.io/badge/Interface-Web%20Serial%20API-4285f4?style=for-the-badge&logo=googlechrome)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)

An automated analog IC testing and operational amplifier characterization suite. The system combines deterministic embedded microcontroller firmware with a zero-driver browser control station powered by Next.js and the W3C Web Serial API.

---

## System Architecture

```text
┌───────────────────────────────────────────────┐
│        Next.js Web Serial Frontend            │
│  - Zero-driver browser hardware arbitration   │
│  - Interactive telemetry & transfer curve log │
│  - Dynamic input & feedback resistor selector │
└───────────────────────┬───────────────────────┘
                        │ USB CDC Serial (115200 baud)
                        │ Newline-delimited JSON RPC
                        ▼
┌───────────────────────────────────────────────┐
│           Embedded Firmware (MCU)             │
│  - CD74HC4067 16-channel MUX sequencer        │
│  - ADS1115 16-bit differential I2C ADC reader │
│  - Settling delay enforcement (7t switch time)│
│  - Closed-loop gain & parameter extractor     │
└───────────────────────────────────────────────┘
```

The system is bifurcated into two coordinated layers:

1. **Deterministic Embedded Firmware (C++ / Arduino / PlatformIO)**
   - Sequenced control of five CD74HC4067 16-channel analog multiplexers (`U4`, `U6`, `U7`, `U8`, `U10`).
   - Microsecond-level settling delay enforcement (80 us) to account for multiplexer R_ON and parasitic PCB capacitances (7 tau).
   - High-resolution ADC readout with ADS1115 over 400 kHz Fast-Mode I2C (differential voltage acquisition down to 0.125 mV/count).
   - Non-blocking newline-delimited JSON stream over USB CDC Serial.

2. **Zero-Driver Browser Control Station (Next.js / React / Tailwind)**
   - Leverages the browser-native W3C Web Serial API via custom hooks (`useWebSerial`) for driverless plug-and-play hardware connectivity.
   - Real-time telemetry streaming and state visualization.
   - Automated mode dispatch (`AUTO`, `SWEEP`, `CUSTOM_GAIN`, `MANUAL`).
   - Live extraction of DC/AC operational parameters: Input Offset Vos, Input Bias Ib, Open Loop Gain Aol.

---

## Hardware Configuration

### Multiplexer Banks (CD74HC4067)

| Identifier | Functional Role                             | Address Pins (S0-S3)  | Enable Pin |
|------------|---------------------------------------------|-----------------------|------------|
| `MUX_U4`  | Non-inverting Input Selection (Input MUX A) | D2, D3, D4, D5        | GND        |
| `MUX_U6`  | Input Attenuator Bank A                     | D6, D7, D8, D9        | GND        |
| `MUX_U7`  | Inverting Input Selection (Input MUX B)     | D10, D11, D12, D13    | GND        |
| `MUX_U8`  | Input Attenuator Bank B                     | D14, D15, D16, D17    | GND        |
| `MUX_U10` | Output Feedback Resistance Network          | D18, D19, D20, D21    | GND        |

**Settling Time Constant:** The firmware enforces an 80 us delay after every channel transition to ensure transient settling across the analog switch matrix before triggering conversions.

### Precision ADC (ADS1115)

- **Bus:** I2C at 400 kHz Fast Mode
- **Default Address:** `0x48`
- **Full-Scale Range (PGA):** +/- 4.096 V (0.125 mV per LSB count)

---

## Pin Map (from Schematic)

### Page 2 — Input MUX A (U4) + Attenuator MUX A (U6)

| Signal                  | Arduino Pin | Role                         |
|-------------------------|-------------|------------------------------|
| Intermediate Voltage 1  | Pin 2       | 3.3V voltage divider         |
| Intermediate Voltage 2  | Pin 3       | 2.5V voltage divider         |
| Function Generator      | External    | Stimulus input signal        |
| Arduino Custom Signal   | Pin 10      | Firmware-generated signal    |
| Custom Output           | External    | User-routed external signal  |
| S0 L                    | Pin 11      | MUX select bit 0, left bank  |
| S1 L                    | Pin 12      | MUX select bit 1, left bank  |
| S2 L                    | Pin 13      | MUX select bit 2, left bank  |
| S0 R                    | Pin 14      | MUX select bit 0, right bank |
| S1 R                    | Pin 15      | MUX select bit 1, right bank |
| S2 R                    | Pin 16      | MUX select bit 2, right bank |

### Page 4 — Input MUX B (U7) + Attenuator MUX B (U8)

| Signal                  | Arduino Pin   | Role                          |
|-------------------------|---------------|-------------------------------|
| Intermediate Voltage 1  | Pin 2 (Ext)   | 3.3V divider, extended route  |
| Intermediate Voltage 2  | Pin 3 (Ext)   | 2.5V divider, extended route  |
| Function Generator      | External      | Stimulus input signal         |
| Arduino Custom Signal   | Pin 17        | Firmware-generated signal B   |
| Custom Output           | External      | User-routed external pin      |
| S0 L                    | Pin 18        | MUX select bit 0, left bank   |
| S1 L                    | Pin 19        | MUX select bit 1, left bank   |
| S2 L                    | Pin 20        | MUX select bit 2, left bank   |
| S0 R                    | Pin 21        | MUX select bit 0, right bank  |
| S1 R                    | Pin 22        | MUX select bit 1, right bank  |
| S2 R                    | Pin 23        | MUX select bit 2, right bank  |

### Page 5 — Voltage Generator / Attenuator MUX (3-bank)

| Signal            | Arduino Pin | Role                              |
|-------------------|-------------|-----------------------------------|
| Voltage Gen Att 1 | MUX output  | Attenuated voltage generator out 1|
| Voltage Gen Att 2 | TBD         | Attenuated voltage generator out 2|
| S0 L              | Pin 24      | Left bank select bit 0            |
| S1 L              | Pin 25      | Left bank select bit 1            |
| S2 L              | Pin 26      | Left bank select bit 2            |
| S0 M              | Pin 27      | Mid bank select bit 0             |
| S1 M              | Pin 28      | Mid bank select bit 1             |
| S2 M              | Pin 29      | Mid bank select bit 2             |
| S0 R              | Pin 30      | Right bank select bit 0           |
| S1 R              | Pin 31      | Right bank select bit 1           |
| S2 R              | Pin 32      | Right bank select bit 2           |

---

## Operating Modes

| Mode          | Command                                                  | Functionality                                                                 |
|---------------|----------------------------------------------------------|-------------------------------------------------------------------------------|
| `IDLE`        | `{"cmd":"SET_MODE","mode":"IDLE"}`                       | Places multiplexers and test benches into high-impedance quiescent state.     |
| `AUTO`        | `{"cmd":"SET_MODE","mode":"AUTO"}`                       | Executes zero-differential baseline routine to extract Vos, Ib, Aol.         |
| `SWEEP`       | `{"cmd":"START_SWEEP","start_v":0,"stop_v":4.5,"step_v":0.05}` | Sweeps input stimulus and streams matched Vin/Vout transfer points.    |
| `CUSTOM_GAIN` | `{"cmd":"TEST_GAIN","input_mux_ch":X,"feedback_mux_ch":Y}` | Routes designated input and feedback resistor to measure closed-loop gain.  |
| `MANUAL`      | `{"cmd":"MANUAL_ROUTE","mux":"U4","ch":N}`               | Low-level direct MUX routing for debugging and calibration.                   |
| `CALIBRATION` | `{"cmd":"CALIBRATE","params":{"bench_gain":100}}`        | Sends bench calibration parameters to the firmware.                           |

---

## Serial Protocol (JSON RPC over CDC UART)

All transactions occur at **115200 baud, 8N1**, delimited by `\n`.

### Uplink Commands (Host to MCU)

```json
{"cmd":"SET_MODE","mode":"AUTO"}
{"cmd":"START_SWEEP","start_v":0.0,"stop_v":4.5,"step_v":0.05}
{"cmd":"TEST_GAIN","input_mux_ch":2,"feedback_mux_ch":0,"bank":"A"}
{"cmd":"MANUAL_ROUTE","mux":"U4","ch":3}
{"cmd":"CALIBRATE","params":{"bench_gain":100}}
{"cmd":"PING"}
```

### Downlink Telemetry (MCU to Host)

```json
{"status":"READY","system":"OPAMP_TESTBENCH_V1"}
{"ack":true,"mode_set":true}
{"event":"SWEEP_START"}
{"vin":0.050,"vout":0.055}
{"event":"SWEEP_COMPLETE"}
{"event":"PARAM_DATA","vos_mv":0.024,"ib_na":12.5,"aol_db":92.0}
{"event":"AUTO_COMPLETE"}
{"event":"PONG","uptime_ms":12345}
```

---

## Dashboard Features

The browser control station at `localhost:3000` provides the following panels:

- **Sweep & Plot** — Configurable transfer sweep (start/stop/step), live Chart.js scatter plot with linear regression overlay, gain flatness chart, data table, CSV/JSON export.
- **Custom Gain** — MUX bank A/B selector with labeled hardware channels (from schematic), feedback resistor network selection with approximate gain readout, post-test regression analysis.
- **Manual Route** — Direct MUX instance and channel control, 16-button quick-pick matrix, live command preview.
- **Calibration** — Bench gain configuration, live extracted parameter table (Vos, Ib, Aol, CMRR, PSRR, Bandwidth).
- **Pin Map** — Full 3-page hardware reference table decoded from schematic.
- **Protocol** — Complete TX/RX JSON command reference.
- **Serial Console** — Color-coded RX/TX/system log with timestamps, manual send box, byte counters.

---

## Repository Structure

```text
opamp-characterization-bench/
├── firmware/
│   ├── include/
│   │   ├── config.hpp          -- Pin assignments, MUX definitions, ADC parameters
│   │   └── multiplexer.hpp     -- CD74HC4067 hardware abstraction layer
│   └── src/
│       ├── main.cpp            -- State machine, command parser, JSON telemetry dispatch
│       └── multiplexer.cpp     -- Multiplexer bit-shifting and settling delay routines
│
└── frontend/
    ├── src/
    │   ├── app/
    │   │   ├── page.tsx        -- Primary dashboard (charts, tabs, metrics)
    │   │   ├── layout.tsx      -- Root application layout
    │   │   └── globals.css     -- Tailwind CSS style definitions
    │   ├── hooks/
    │   │   └── useWebSerial.ts -- W3C Web Serial API stream transport wrapper
    │   ├── types/
    │   │   └── protocol.ts     -- TypeScript interfaces matching MCU JSON frames
    │   └── utils/
    │       └── dsp.ts          -- Linregress, gain/dB, slew rate, CSV export helpers
    ├── package.json
    ├── tsconfig.json
    └── next.config.ts
```

---

## Quick Start

### 1. Firmware

Open `firmware/` in PlatformIO or Arduino IDE:

1. Target MCU: ESP32, ATmega2560, or compatible (20+ digital GPIOs, I2C).
2. Verify pin mappings in `firmware/include/config.hpp`.
3. Flash over USB and confirm boot handshake at 115200 baud:
   ```json
   {"status":"READY","system":"OPAMP_TESTBENCH_V1"}
   ```

### 2. Frontend

Prerequisites: Node.js 18+ and a Chromium-based browser (Chrome, Edge, or Opera) for Web Serial API support.

```bash
cd opamp-characterization-bench/frontend
npm install
npm run dev
```

Open `http://localhost:3000`, click **Open Serial Interface**, select the MCU port, and use the mode bar to run tests.

### 3. Production Build

```bash
cd opamp-characterization-bench/frontend
npm run build
```

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
