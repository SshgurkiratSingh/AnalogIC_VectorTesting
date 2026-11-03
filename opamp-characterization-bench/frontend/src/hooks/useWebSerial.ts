'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { LogEntry } from '@/types/protocol';

export interface WebSerialReturn {
  isConnected: boolean;
  portInfo: string | null;
  bytesRx: number;
  bytesTx: number;
  connect: (baudRate?: number) => Promise<void>;
  disconnect: () => Promise<void>;
  send: (data: string) => Promise<void>;
  logs: LogEntry[];
  clearLogs: () => void;
}

let logIdCounter = 0;

export function useWebSerial(onLineReceived: (line: string) => void): WebSerialReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [portInfo, setPortInfo] = useState<string | null>(null);
  const [bytesRx, setBytesRx] = useState(0);
  const [bytesTx, setBytesTx] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const portRef = useRef<any>(null);
  const writerRef = useRef<any>(null);

  const addLog = useCallback((raw: string, type: LogEntry['type'], parsed?: Record<string, unknown>) => {
    setLogs(prev => [...prev.slice(-499), {
      id: ++logIdCounter,
      ts: Date.now(),
      raw,
      parsed,
      type,
    }]);
  }, []);

  const connect = useCallback(async (baudRate: number = 115200) => {
    if (!('serial' in navigator)) {
      addLog('Web Serial API is unsupported. Use Chrome, Edge, or Opera.', 'error');
      alert('Web Serial API unsupported. Use Chrome, Edge, or Opera.');
      return;
    }
    try {
      const selectedPort = await (navigator as any).serial.requestPort();
      await selectedPort.open({ baudRate });

      const info = selectedPort.getInfo?.();
      setPortInfo(info ? `VID:0x${info.usbVendorId?.toString(16).toUpperCase() ?? '???'} PID:0x${info.usbProductId?.toString(16).toUpperCase() ?? '???'}` : 'Serial Port');

      const textEncoder = new TextEncoderStream();
      textEncoder.readable.pipeTo(selectedPort.writable!);
      writerRef.current = textEncoder.writable.getWriter();

      const textDecoder = new TextDecoderStream();
      selectedPort.readable!.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();

      portRef.current = selectedPort;
      setIsConnected(true);
      addLog(`Connected at ${baudRate} baud`, 'system');

      // Inbound processing loop
      (async () => {
        let buffer = '';
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            setBytesRx(prev => prev + value.length);
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              const clean = line.trim();
              if (!clean) continue;
              let parsed: Record<string, unknown> | undefined;
              try { parsed = JSON.parse(clean); } catch { /* raw text */ }
              addLog(clean, 'rx', parsed);
              onLineReceived(clean);
            }
          }
        } catch (error) {
          addLog(`Read interrupted: ${error}`, 'error');
        } finally {
          reader.releaseLock();
          setIsConnected(false);
          addLog('Disconnected', 'system');
        }
      })();
    } catch (err: any) {
      if (err?.name !== 'NotFoundError') {
        addLog(`Connection error: ${err}`, 'error');
      }
    }
  }, [onLineReceived, addLog]);

  const send = useCallback(async (data: string) => {
    if (!writerRef.current) return;
    const packet = data.endsWith('\n') ? data : data + '\n';
    await writerRef.current.write(packet);
    setBytesTx(prev => prev + packet.length);
    let parsed: Record<string, unknown> | undefined;
    try { parsed = JSON.parse(data); } catch { /* ok */ }
    addLog(data, 'tx', parsed);
  }, [addLog]);

  const disconnect = useCallback(async () => {
    try {
      if (writerRef.current) {
        await writerRef.current.close();
        writerRef.current = null;
      }
      if (portRef.current) {
        await portRef.current.close();
        portRef.current = null;
      }
    } catch { /* ignore close errors */ }
    setIsConnected(false);
    setPortInfo(null);
    addLog('Disconnected by user', 'system');
  }, [addLog]);

  const clearLogs = useCallback(() => setLogs([]), []);

  return { isConnected, portInfo, bytesRx, bytesTx, connect, disconnect, send, logs, clearLogs };
}
