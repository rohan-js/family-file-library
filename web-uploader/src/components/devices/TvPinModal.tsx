import React, { useState } from 'react';
import { X, Lock, Check, ShieldAlert } from 'lucide-react';
import { setOrUpdateTvPin, clearTvPin } from '../../lib/tvPin';
import { validateTvPin } from '../../lib/crypto';

interface TvPinModalProps {
  isOpen: boolean;
  spaceId: string;
  hasExistingPin: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const TvPinModal: React.FC<TvPinModalProps> = ({
  isOpen,
  spaceId,
  hasExistingPin,
  onClose,
  onSuccess,
}) => {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const val = validateTvPin(pin);
    if (!val.valid) {
      setError(val.error);
      return;
    }

    if (pin !== confirmPin) {
      setError('PINs do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      await setOrUpdateTvPin(spaceId, pin);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update TV PIN.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClearPin = async () => {
    if (!window.confirm('Are you sure you want to remove the PIN lock? Anyone with the TV remote will have unrestricted access.')) {
      return;
    }
    setIsSubmitting(true);
    try {
      await clearTvPin(spaceId);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to clear TV PIN.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-tv-card border border-tv-border rounded-2xl w-full max-w-sm p-6 shadow-2xl text-tv-textLight">
        <div className="flex items-center justify-between pb-4 border-b border-tv-border">
          <h2 className="text-lg font-bold flex items-center space-x-2">
            <Lock className="w-5 h-5 text-tv-cyan" />
            <span>{hasExistingPin ? 'Update TV PIN Lock' : 'Set TV PIN Lock'}</span>
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-tv-textMuted hover:text-tv-textLight hover:bg-tv-elevated transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="my-4 p-3 bg-tv-dangerBg border border-tv-danger/30 text-tv-danger rounded-xl text-xs flex items-center space-x-2">
            <ShieldAlert className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-tv-textMuted mb-1.5">
              4-Digit Numeric PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                setError(null);
              }}
              placeholder="••••"
              autoFocus
              className="w-full text-center text-2xl font-mono tracking-widest bg-tv-bg border border-tv-border rounded-xl py-2.5 px-4 text-tv-cyan focus:outline-none focus:border-tv-cyan"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-tv-textMuted mb-1.5">
              Confirm 4-Digit PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              value={confirmPin}
              onChange={(e) => {
                setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                setError(null);
              }}
              placeholder="••••"
              className="w-full text-center text-2xl font-mono tracking-widest bg-tv-bg border border-tv-border rounded-xl py-2.5 px-4 text-tv-cyan focus:outline-none focus:border-tv-cyan"
            />
          </div>

          <div className="pt-2 flex flex-col space-y-2">
            <button
              type="submit"
              disabled={isSubmitting || pin.length !== 4 || confirmPin.length !== 4}
              className="w-full bg-tv-blue hover:bg-tv-blueHover text-white font-semibold py-2.5 px-4 rounded-xl shadow-lg disabled:opacity-50 transition-all flex items-center justify-center space-x-2 text-sm"
            >
              <Check className="w-4 h-4" />
              <span>{isSubmitting ? 'Saving PIN...' : hasExistingPin ? 'Update PIN' : 'Save PIN'}</span>
            </button>

            {hasExistingPin && (
              <button
                type="button"
                onClick={handleClearPin}
                disabled={isSubmitting}
                className="w-full py-2 text-xs font-semibold text-tv-danger hover:bg-tv-dangerBg rounded-xl transition-colors"
              >
                Remove PIN Lock
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
