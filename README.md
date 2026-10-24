# AnalogIC VectorTesting & Op-Amp Characterization Bench

[![Next.js 15](https://img.shields.io/badge/Frontend-Next.js%2015-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/UI-React%2019-61dafb?style=for-the-badge&logo=react)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Styling-Tailwind%20CSS-38bdf8?style=for-the-badge&logo=tailwindcss)](https://tailwindcss.com/)
[![C++](https://img.shields.io/badge/Firmware-C%2B%2B%20%2F%20Embedded-00599c?style=for-the-badge&logo=c%2B%2B)](https://isocpp.org/)
[![Web Serial API](https://img.shields.io/badge/Interface-Web%20Serial%20API-4285f4?style=for-the-badge&logo=googlechrome)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)

An automated analog IC testing and operational amplifier characterization suite. The system combines deterministic embedded microcontroller firmware with a zero-driver browser control station powered by Next.js and the W3C Web Serial API.

---

## 📐 System Architecture

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
│  - Settling delay enforcement (7τ switch time)│
│  - Closed-loop gain & parameter extractor     │
└───────────────────────────────────────────────┘
```

The system is bifurcated into two coordinated layers:

1. **Deterministic Embedded Firmware (C++ / Arduino / PlatformIO)**
   - Sequenced control of five CD74HC4067 16-channel analog multiplexers (`U4`, `U6`, `U7`, `U8`, `U10`).
   - Microsecond-level settling delay enforcement ($80\,\mu\text{s}$) to account for multiplexer $R_{\text{ON}}$ and parasitic PCB capacitances ($7\tau$).
   - High-resolution ADC readout with ADS1115 over $400\,\text{kHz}$ Fast-Mode $\text{I}^2\text{C}$ (differential voltage acquisition down to $0.125\,\text{mV/count}$).
   - Non-blocking newline-delimited JSON stream over USB CDC Serial.

2. **Zero-Driver Browser Control Station (Next.js 15+ / React / Tailwind)**
   - Leverages the browser-native **W3C Web Serial API** via custom hooks (`useWebSerial`) for driverless plug-and-play hardware connectivity.
   - Real-time telemetry streaming and state visualization.
   - Automated mode dispatch (`AUTO`, `SWEEP`, `CUSTOM_GAIN`, `MANUAL`).
   - Live extraction of DC/AC operational parameters (Input Offset $V_{\text{OS}}$, Input Bias $I_{\text{B}}$, Open Loop Gain $A_{\text{OL}}$).

---

## ⚡ Hardware Configuration

### Multiplexer Banks (CD74HC4067)

| Identifier | Functional Role | Address Pins (S0–S3) | Enable Pin |
|---|---|---|---|
| `MUX_U4` | Non-inverting Input Selection (Input MUX A) | D2, D3, D4, D5 | GND |
| `MUX_U6` | Input Attenuator Bank A | D6, D7, D8, D9 | GND |
| `MUX_U7` | Inverting Input Selection (Input MUX B) | D10, D11, D12, D13 | GND |
| `MUX_U8` | Input Attenuator Bank B | D14, D15, D16, D17 | GND |
| `MUX_U10` | Output Feedback Resistance Network | D18, D19, D20, D21 | GND |

> **Settling Time Constant:** The firmware enforces an $80\,\mu\text{s}$ delay after every channel transition to ensure transient settling across the analog switch matrix before triggering conversions.

### Precision ADC (ADS1115)
- **Bus:** $\text{I}^2\text{C}$ at $400\,\text{kHz}$ Fast Mode
- **Default Address:** `0x48`
- **Full-Scale Range (PGA):** $\pm 4.096\,\text{V}$ ($0.125\,\text{mV}$ per LSB count)

---

## 🎛️ Operating Modes

| Mode | Command | Functionality |
|---|---|---|
| `IDLE` | `{"cmd":"SET_MODE","mode":"IDLE"}` | Places multiplexers and test benches into high-impedance / quiescent state. |
| `AUTO` | `{"cmd":"SET_MODE","mode":"AUTO"}` | Executes zero-differential baseline routine to measure and extract input offset voltage ($V_{\text{OS}}$). |
| `SWEEP` | `{"cmd":"START_SWEEP"}` | Sweeps input stimulus ($0.0\,\text{V} \to 4.5\,\text{V}$) and continuously streams matched $\{V_{\text{in}}, V_{\text{out}}\}$ transfer points. |
| `CUSTOM_GAIN` | `{"cmd":"TEST_GAIN","input_mux_ch":X,"feedback_mux_ch":Y}` | Routes designated input channel and feedback resistor to dynamically measure op-amp closed-loop response. |
| `MANUAL` | `{"cmd":"MANUAL_ROUTE","mux":"...","ch":N}` | Low-level direct routing for debugging and calibration. |

---

## 📡 Serial Protocol (JSON RPC over CDC UART)

All transactions occur at **115200 baud, 8N1**, delimited by `\n`.

### Uplink Commands (Host → MCU)

```json
// Switch to Automated Extraction Mode
{"cmd":"SET_MODE","mode":"AUTO"}

// Trigger DC Transfer Sweep
{"cmd":"START_SWEEP"}

// Set Programmable Gain Matrix
{"cmd":"TEST_GAIN","input_mux_ch":4,"feedback_mux_ch":2}
```

### Downlink Telemetry (MCU → Host)

```json
// Boot Announcement
{"status":"READY","system":"OPAMP_TESTBENCH_V1"}

// Automated Parameter Extraction Event
{"event":"AUTO_START"}
{"event":"PARAM_DATA","vos_mv":0.0240}
{"event":"AUTO_COMPLETE"}

// Transfer Sweep Telemetry
{"event":"SWEEP_START"}
{"vin":0.050,"vout":0.055}
{"vin":0.100,"vout":0.106}
{"event":"SWEEP_COMPLETE"}
```

---

## 📂 Repository Structure

```text
opamp-characterization-bench/
├── firmware/
│   ├── include/
│   │   ├── config.hpp                 # Pin assignments, MUX definitions, ADC parameters
│   │   └── multiplexer.hpp            # CD74HC4067 hardware abstraction layer
│   └── src/
│       ├── main.cpp                   # State machine, command parser, JSON telemetry dispatch
│       └── multiplexer.cpp            # Multiplexer bit-shifting & settling delay routines
│
└── frontend/
    ├── src/
    │   ├── app/
    │   │   ├── page.tsx               # Primary dashboard, mode selector & telemetry visualizer
    │   │   ├── layout.tsx             # Root application layout
    │   │   └── globals.css            # Tailwind CSS style definitions
    │   ├── hooks/
    │   │   └── useWebSerial.ts        # W3C Web Serial API stream transport wrapper
    │   └── types/
    │       └── protocol.ts            # TypeScript interfaces matching MCU JSON frames
    ├── package.json
    ├── tsconfig.json
    └── next.config.ts
```

---

## 🚀 Quick Start Guide

### 1. Firmware Installation

Open the `firmware/` directory with your preferred embedded IDE (PlatformIO or Arduino IDE):

1. Target MCU: **ESP32**, **ATmega2560**, or compatible microcontrollers with 20+ digital GPIOs and $\text{I}^2\text{C}$.
2. Verify pin mappings in [`firmware/include/config.hpp`](file:///home/gurkirat/Projects/AnalogIC_test/opamp-characterization-bench/firmware/include/config.hpp).
3. Connect the board over USB and flash the firmware.
4. Verify boot handshake at 115200 baud:
   ```json
   {"status":"READY","system":"OPAMP_TESTBENCH_V1"}
   ```

### 2. Frontend Control Station

Prerequisites: **Node.js 18+** and a browser with Web Serial API support (Google Chrome, Microsoft Edge, Opera, or Chromium-based browsers).

```bash
cd opamp-characterization-bench/frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser:
1. Click **"Open Serial Interface"**.
2. Select your connected microcontroller's serial port in the browser prompt.
3. Use the mode bar to execute automated offset tests, custom gain switching, or dynamic transfer sweeps.

---

## 🛠️ Verification & Build

To verify and create a production build of the Next.js frontend:

```bash
cd opamp-characterization-bench/frontend
npm run build
```

---

## 📄 License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
