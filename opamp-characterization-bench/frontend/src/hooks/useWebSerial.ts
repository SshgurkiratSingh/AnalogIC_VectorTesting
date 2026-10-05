'use client';
import { useState, useRef, useCallback } from 'react';

export function useWebSerial(onLineReceived: (line: string) => void) {
  const [isConnected, setIsConnected] = useState(false);
  const [port, setPort] = useState<any>(null); // Use any for SerialPort as it requires DOM lib
  const writerRef = useRef<any>(null);

  const connect = useCallback(async (baudRate: number = 115200) => {
    if (!('serial' in navigator)) {
      alert('Web Serial API is unsupported by this browser. Use Chrome, Edge, or Opera.');
      return;
    }

    try {
      const selectedPort = await (navigator as any).serial.requestPort();
      await selectedPort.open({ baudRate });

      const textEncoder = new TextEncoderStream();
      textEncoder.readable.pipeTo(selectedPort.writable!);
      writerRef.current = textEncoder.writable.getWriter();

      const textDecoder = new TextDecoderStream();
      selectedPort.readable!.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();

      setIsConnected(true);
      setPort(selectedPort);

      // Inbound processing loop
      (async () => {
        let buffer = '';
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              const clean = line.trim();
              if (clean) onLineReceived(clean);
            }
          }
        } catch (error) {
          console.error('Serial read execution interrupted:', error);
        } finally {
          reader.releaseLock();
        }
      })();
    } catch (err) {
      console.error('Failed to configure Serial Interface:', err);
    }
  }, [onLineReceived]);

  const send = useCallback(async (data: string) => {
    if (!writerRef.current) return;
    await writerRef.current.write(data.endsWith('\n') ? data : data + '\n');
  }, []);

  const disconnect = useCallback(async () => {
    if (writerRef.current) {
      await writerRef.current.close();
      writerRef.current = null;
    }
    if (port) {
      await port.close();
      setPort(null);
    }
    setIsConnected(false);
  }, [port]);

  return { isConnected, connect, disconnect, send };
}
