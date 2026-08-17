import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

// Renders a "Scan barcode" button. On click, opens the device camera in a
// panel and calls onDetected(code) the first time a barcode/QR is read,
// then stops the camera automatically.
export default function BarcodeScanner({ onDetected }) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState(null);
  const elementId = useRef(`scanner-${Math.random().toString(36).slice(2)}`);
  const scannerRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    const scanner = new Html5Qrcode(elementId.current);
    scannerRef.current = scanner;
    setError(null);

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 140 } },
        (decodedText) => {
          onDetected(decodedText);
          stop();
        },
        () => {} // ignore per-frame decode failures
      )
      .catch((err) => setError(err?.message || 'Could not start camera'));

    return () => {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function stop() {
    if (scannerRef.current?.isScanning) {
      scannerRef.current.stop().then(() => setActive(false)).catch(() => setActive(false));
    } else {
      setActive(false);
    }
  }

  if (!active) {
    return <button type="button" className="btn btn-secondary" onClick={() => setActive(true)}>📷 Scan barcode</button>;
  }

  return (
    <div className="scanner-box">
      <div id={elementId.current} style={{ width: '100%', maxWidth: 320 }} />
      {error && <p className="muted" style={{ color: '#b3372c' }}>{error} — enter the barcode number manually instead.</p>}
      <button type="button" className="btn btn-secondary" style={{ marginTop: 8 }} onClick={stop}>Cancel</button>
    </div>
  );
}
