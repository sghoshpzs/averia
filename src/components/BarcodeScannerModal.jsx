import React, { useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

const SCANNER_ELEMENT_ID = "barcode-scanner-region";

export default function BarcodeScannerModal({ onDetected, onClose }) {
  const scannerRef = useRef(null);

  useEffect(() => {
    const html5Qrcode = new Html5Qrcode(SCANNER_ELEMENT_ID);
    scannerRef.current = html5Qrcode;

    html5Qrcode
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 120 } },
        (decodedText) => {
          onDetected(decodedText);
          html5Qrcode.stop().catch(() => {});
        },
        () => {} // ignore per-frame scan failures
      )
      .catch((err) => {
        console.error("Camera start failed:", err);
      });

    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current.clear();
      }
    };
  }, [onDetected]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Scan Barcode</h3>
          <button className="btn-icon" onClick={onClose}>
            ✕
          </button>
        </div>
        <div id={SCANNER_ELEMENT_ID} className="scanner-region" />
        <p className="help-text">Point the camera at the barcode / QR label on the item's tag.</p>
      </div>
    </div>
  );
}
