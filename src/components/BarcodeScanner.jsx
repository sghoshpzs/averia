import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

// Renders a "Scan barcode" button (or, in compact mode, a bare camera-icon
// button meant to sit inline next to a text input) plus a "Take photo"
// fallback. Live scan calls onDetected(code) the first time a barcode/QR is
// read from the video feed, then stops the camera automatically. Take photo
// opens the device's native camera app for a single still shot instead —
// its own autofocus/exposure pipeline is often far more reliable for 1D
// barcodes than a getUserMedia video stream, especially in poor lighting.
export default function BarcodeScanner({ onDetected, compact }) {
  const [active, setActive] = useState(false);
  const [decodingPhoto, setDecodingPhoto] = useState(false);
  const [error, setError] = useState(null);
  const elementId = useRef(`scanner-${Math.random().toString(36).slice(2)}`);
  const scannerRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    // useBarCodeDetectorIfSupported defaults to true, which hands scanning
    // off to the browser's native BarcodeDetector API on any device that
    // exposes it (most modern Android Chrome, and increasingly desktop
    // Chrome/Edge). That native implementation is QR-first and unreliable
    // for 1D symbologies (Code128/EAN/ITF, i.e. what's actually printed on
    // inventory labels) — camera opens fine, but it just never fires a
    // detection. Forcing it off routes every scan through html5-qrcode's
    // bundled zxing decoder instead, which handles 1D barcodes properly.
    const scanner = new Html5Qrcode(elementId.current, { useBarCodeDetectorIfSupported: false });
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
      .catch((err) => setError((err?.message || 'Could not start camera') + ' — enter the barcode number manually instead.'));

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

  async function handlePhotoSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so picking the same file again still fires onChange
    if (!file) return;

    setError(null);
    setDecodingPhoto(true);
    // A fresh instance, decoding a still image rather than a live feed —
    // showImage: false so it doesn't try to render the photo into the
    // (currently hidden) scanner element.
    const photoScanner = new Html5Qrcode(elementId.current, { useBarCodeDetectorIfSupported: false });
    try {
      const decodedText = await photoScanner.scanFile(file, false);
      onDetected(decodedText);
    } catch {
      setError('No barcode found in that photo — try again with the code centered, well-lit, and in focus, or enter the number manually.');
    } finally {
      setDecodingPhoto(false);
    }
  }

  return (
    <div className={compact ? undefined : 'scanner-box-wrap'}>
      {!active && (
        <div style={{ display: 'flex', gap: 8 }}>
          {compact ? (
            <button type="button" className="barcode-scan-icon-btn" title="Scan barcode" aria-label="Scan barcode" onClick={() => setActive(true)}>
              📷
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => setActive(true)}>📷 Scan barcode</button>
          )}
          {compact ? (
            <button
              type="button"
              className="barcode-scan-icon-btn"
              title="Take a photo of the barcode"
              aria-label="Take a photo of the barcode"
              disabled={decodingPhoto}
              onClick={() => fileInputRef.current?.click()}
            >
              📸
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" disabled={decodingPhoto} onClick={() => fileInputRef.current?.click()}>
              {decodingPhoto ? 'Decoding…' : '📸 Take photo'}
            </button>
          )}
        </div>
      )}

      {active && (
        <div className="scanner-box">
          <div id={elementId.current} style={{ width: '100%', maxWidth: 320 }} />
          <button type="button" className="btn btn-secondary" style={{ marginTop: 8 }} onClick={stop}>Cancel</button>
        </div>
      )}

      {/* Always mounted when not live-scanning (hidden off-screen) — the
          Html5Qrcode constructor requires this element to already exist,
          and scanFile() needs a target to attach to even with showImage
          off. */}
      {!active && <div id={elementId.current} style={{ display: 'none' }} />}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handlePhotoSelected}
      />

      {error && <p className="muted" style={{ color: '#b3372c', marginTop: 6 }}>{error}</p>}
    </div>
  );
}
