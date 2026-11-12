import React, { useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Sparkles, ArrowRight } from 'lucide-react';

interface OnboardingModalProps {
  isOpen: boolean;
  user: User;
  onSubmit: (spaceName: string) => Promise<void>;
  isSubmitting: boolean;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  user,
  onSubmit,
  isSubmitting,
}) => {
  const defaultName = `${user.user_metadata?.full_name || 'My Family'}'s Library`;
  const [spaceName, setSpaceName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = spaceName.trim();
    if (!trimmed || trimmed.length < 2 || trimmed.length > 100) {
      setError('Space name must be between 2 and 100 characters.');
      return;
    }
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch (err: any) {
      setError(err.message || 'Failed to create space.');
    }
  };

  return (
    <div className="bg-tv-card border border-tv-border rounded-2xl w-full max-w-md p-6 sm:p-8 shadow-2xl text-tv-textLight relative z-20">
      <div className="w-12 h-12 bg-tv-cyan/20 border border-tv-cyan/40 rounded-xl flex items-center justify-center mb-4">
        <Sparkles className="w-6 h-6 text-tv-cyan" />
      </div>

      <h2 className="text-xl font-bold mb-1">Create Your Family Space</h2>
      <p className="text-sm text-tv-textMuted mb-6">
        Every family library is stored in a private Space shared with your household and Android TV.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-tv-dangerBg border border-tv-danger/30 text-tv-danger rounded-lg text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-tv-textMuted mb-1.5">
            Space Name
          </label>
          <input
            type="text"
            value={spaceName}
            onChange={(e) => {
              setSpaceName(e.target.value);
              setError(null);
            }}
            maxLength={100}
            required
            className="w-full bg-tv-bg border border-tv-border rounded-xl px-4 py-3 text-tv-textLight placeholder-tv-textMuted focus:outline-none focus:border-tv-cyan focus:ring-1 focus:ring-tv-cyan text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !spaceName.trim()}
          className="w-full mt-2 bg-tv-blue hover:bg-tv-blueHover text-white font-semibold py-3 px-4 rounded-xl shadow-lg disabled:opacity-50 transition-all flex items-center justify-center space-x-2"
        >
          <span>{isSubmitting ? 'Creating Space...' : 'Get Started'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
