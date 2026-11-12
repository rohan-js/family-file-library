import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { QrScanner } from '../components/pairing/QrScanner';
import { PairingCodeInput, sanitizePairingCode } from '../components/pairing/PairingCodeInput';
import { Tv, CheckCircle, AlertCircle, Camera, Keyboard, ArrowRight } from 'lucide-react';

export const PairingView: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { spaces, activeSpace, setActiveSpaceId } = useAuth();

  const [code, setCode] = useState('');
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(activeSpace?.id || '');
  const [scanMode, setScanMode] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pairedDevice, setPairedDevice] = useState<{ id: string; name: string } | null>(null);

  // Sync selectedSpaceId when activeSpace loads
  useEffect(() => {
    if (activeSpace && !selectedSpaceId) {
      setSelectedSpaceId(activeSpace.id);
    }
  }, [activeSpace, selectedSpaceId]);

  // Read ?code= from URL if present
  useEffect(() => {
    const codeParam = searchParams.get('code');
    if (codeParam) {
      const sanitized = sanitizePairingCode(codeParam);
      setCode(sanitized);
      setScanMode(false); // Switch to manual display so user sees the scanned code
    }
  }, [searchParams]);

  const handleScanSuccess = (decoded: string) => {
    try {
      let extractedCode = decoded;
      if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
        const u = new URL(decoded);
        const p = u.searchParams.get('code');
        if (p) extractedCode = p;
      } else if (decoded.startsWith('pair://')) {
        extractedCode = decoded.replace('pair://', '');
      }
      const sanitized = sanitizePairingCode(extractedCode);
      if (sanitized.length >= 6) {
        setCode(sanitized);
        setScanMode(false);
      }
    } catch {
      const sanitized = sanitizePairingCode(decoded);
      if (sanitized.length >= 6) {
        setCode(sanitized);
        setScanMode(false);
      }
    }
  };

  const isSubmitEnabled = code.length >= 6 && Boolean(selectedSpaceId) && !isSubmitting;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isSubmitEnabled) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const cleanCode = sanitizePairingCode(code);
      const { data, error } = await supabase.rpc('approve_tv_pairing_code', {
        p_code: cleanCode,
        p_space_id: selectedSpaceId,
      });

      if (error) {
        let msg = error.message;
        if (msg.includes('Invalid or expired')) {
          msg = 'Invalid or expired pairing code. Please check your TV screen.';
        } else if (msg.includes('Access denied')) {
          msg = 'Access denied. You must be an authorized member of this space.';
        }
        setErrorMessage(msg);
        return;
      }

      const res = data as any;
      if (res?.success) {
        setPairedDevice({
          id: res.device_id,
          name: res.device_name || 'Android TV',
        });
      } else {
        setErrorMessage('Pairing was not approved. Please try again.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Network error occurred during TV pairing.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (pairedDevice) {
    return (
      <div className="max-w-md mx-auto p-6 mt-8 bg-tv-card border border-tv-border rounded-2xl text-center shadow-2xl animate-fadeIn">
        <div className="w-16 h-16 bg-emerald-500/20 border border-emerald-500/40 rounded-2xl mx-auto flex items-center justify-center mb-4">
          <CheckCircle className="w-8 h-8 text-emerald-400" />
        </div>
        <h2 className="text-xl font-bold text-tv-textLight mb-1">Android TV Paired!</h2>
        <p className="text-sm text-tv-textMuted mb-6">
          <strong className="text-tv-cyan">{pairedDevice.name}</strong> is now securely connected to your family library.
        </p>
        <button
          onClick={() => navigate('/')}
          className="w-full bg-tv-blue hover:bg-tv-blueHover text-white font-semibold py-3 px-4 rounded-xl shadow-lg transition-all flex items-center justify-center space-x-2"
        >
          <span>Go to Library</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto p-4 sm:p-6 text-tv-textLight">
      <div className="text-center mb-6">
        <div className="w-12 h-12 bg-tv-elevated border border-tv-cyan/30 rounded-xl mx-auto flex items-center justify-center mb-3">
          <Tv className="w-6 h-6 text-tv-cyan" />
        </div>
        <h1 className="text-2xl font-bold">Pair Android TV</h1>
        <p className="text-sm text-tv-textMuted mt-1">
          Scan the QR code or enter the 6-character code displayed on your TV screen.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex bg-tv-card p-1 rounded-xl border border-tv-border mb-6 max-w-xs mx-auto">
        <button
          type="button"
          onClick={() => setScanMode(true)}
          className={`flex-1 flex items-center justify-center space-x-2 py-2 text-xs font-semibold rounded-lg transition-colors ${
            scanMode ? 'bg-tv-elevated text-tv-cyan shadow' : 'text-tv-textMuted hover:text-tv-textLight'
          }`}
        >
          <Camera className="w-4 h-4" />
          <span>Scan QR</span>
        </button>
        <button
          type="button"
          onClick={() => setScanMode(false)}
          className={`flex-1 flex items-center justify-center space-x-2 py-2 text-xs font-semibold rounded-lg transition-colors ${
            !scanMode ? 'bg-tv-elevated text-tv-cyan shadow' : 'text-tv-textMuted hover:text-tv-textLight'
          }`}
        >
          <Keyboard className="w-4 h-4" />
          <span>Enter Code</span>
        </button>
      </div>

      {errorMessage && (
        <div className="mb-6 p-4 bg-tv-dangerBg border border-tv-danger/30 text-tv-danger rounded-xl text-sm flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Pairing Failed</p>
            <p className="text-xs text-tv-danger/90 mt-0.5">{errorMessage}</p>
          </div>
        </div>
      )}

      {scanMode ? (
        <div className="mb-6">
          <QrScanner onScanSuccess={handleScanSuccess} />
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-5 bg-tv-card border border-tv-border p-6 rounded-2xl shadow-xl">
        {/* Space Selector */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-tv-textMuted mb-2">
            Target Family Space
          </label>
          <select
            value={selectedSpaceId}
            onChange={(e) => {
              setSelectedSpaceId(e.target.value);
              setActiveSpaceId(e.target.value);
            }}
            className="w-full bg-tv-bg border border-tv-border rounded-xl px-4 py-3 text-tv-textLight text-sm focus:outline-none focus:border-tv-cyan"
          >
            {spaces.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.name} ({sp.role})
              </option>
            ))}
          </select>
        </div>

        {/* Pairing Code Input */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-tv-textMuted mb-2">
            6-Character Pairing Code
          </label>
          <PairingCodeInput
            value={code}
            onChange={(val) => {
              setCode(val);
              setErrorMessage(null);
            }}
            disabled={isSubmitting}
          />
        </div>

        <button
          type="submit"
          disabled={!isSubmitEnabled}
          className="w-full bg-tv-blue hover:bg-tv-blueHover text-white font-semibold py-3.5 px-4 rounded-xl shadow-lg disabled:opacity-50 transition-all flex items-center justify-center space-x-2 text-sm"
        >
          {isSubmitting ? (
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Approving TV Access...</span>
            </div>
          ) : (
            <span>Approve TV Access</span>
          )}
        </button>
      </form>
    </div>
  );
};
