import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { Camera, AlertCircle } from 'lucide-react';

interface QrScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onError?: (error: string) => void;
}

export const QrScanner: React.FC<QrScannerProps> = ({ onScanSuccess, onError }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const codeReader = new BrowserMultiFormatReader();
    let isCancelled = false;
    let localStream: MediaStream | null = null;

    async function startScanner() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera streaming is not supported on this device or browser.');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });

        if (isCancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        localStream = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCameraActive(true);

          try {
            codeReader.decodeFromVideoElement(videoRef.current, (result, _err) => {
              if (result && !isCancelled) {
                const text = result.getText();
                onScanSuccess(text);
              }
            });
          } catch (e: any) {
            console.warn('[QrScanner] decode error:', e);
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Camera access denied or unavailable';
        setErrorMessage(msg);
        if (onError) onError(msg);
      }
    }

    startScanner();

    return () => {
      isCancelled = true;
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      if (videoRef.current && videoRef.current.srcObject) {
        const s = videoRef.current.srcObject as MediaStream;
        s.getTracks().forEach((t) => t.stop());
      }
    };
  }, [onScanSuccess, onError]);

  if (errorMessage) {
    return (
      <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl text-center max-w-sm mx-auto">
        <AlertCircle className="w-6 h-6 text-amber-400 mx-auto mb-2" />
        <p className="text-xs text-amber-200 font-medium">
          Camera unavailable: {errorMessage}
        </p>
        <p className="text-xs text-tv-textMuted mt-1">
          Please enter the 6-character code manually below.
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full max-w-xs mx-auto aspect-square rounded-2xl overflow-hidden bg-black border-2 border-tv-elevated shadow-xl">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />
      {cameraActive ? (
        <div className="absolute inset-0 border-2 border-tv-cyan/70 rounded-2xl pointer-events-none flex items-center justify-center">
          <div className="w-44 h-44 border-2 border-dashed border-tv-cyan rounded-xl animate-pulse" />
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-tv-textMuted">
          <Camera className="w-8 h-8 animate-pulse mb-2 text-tv-cyan" />
          <span className="text-xs">Starting camera...</span>
        </div>
      )}
    </div>
  );
};
