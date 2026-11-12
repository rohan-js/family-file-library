import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { GoogleSignInButton } from './GoogleSignInButton';
import { Tv, FolderGit2, Shield, Sparkles } from 'lucide-react';
import { OnboardingModal } from './OnboardingModal';

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading, spaces, createSpace } = useAuth();
  const [isCreatingSpace, setIsCreatingSpace] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-tv-bg flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 rounded-full border-4 border-tv-cyan/30 border-t-tv-cyan animate-spin mb-4" />
        <p className="text-tv-textMuted text-sm">Connecting to Family File Library...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-tv-bg flex flex-col items-center justify-center p-4 relative overflow-hidden">
        {/* Ambient background glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-tv-cyan/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-md w-full bg-tv-card/80 backdrop-blur-md border border-tv-border rounded-2xl p-8 shadow-2xl relative z-10 text-center">
          <div className="w-16 h-16 bg-tv-elevated border border-tv-cyan/40 rounded-2xl mx-auto flex items-center justify-center shadow-lg shadow-tv-cyan/10 mb-6">
            <Tv className="w-8 h-8 text-tv-cyan" />
          </div>

          <h1 className="text-2xl font-bold text-tv-textLight tracking-tight mb-2">
            Android TV Family Files
          </h1>
          <p className="text-tv-textMuted text-sm mb-8">
            Upload, organize, and view your family photos, PDFs, and documents directly on the big screen.
          </p>

          <div className="space-y-3 mb-8 text-left text-xs text-tv-textMuted bg-tv-bg/60 p-4 rounded-xl border border-tv-border">
            <div className="flex items-center space-x-2.5">
              <Sparkles className="w-4 h-4 text-tv-cyan flex-shrink-0" />
              <span>Native Android share sheet & WhatsApp ingestion</span>
            </div>
            <div className="flex items-center space-x-2.5">
              <FolderGit2 className="w-4 h-4 text-tv-blue flex-shrink-0" />
              <span>Hierarchical family library with 50MB file uploads</span>
            </div>
            <div className="flex items-center space-x-2.5">
              <Shield className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>Remote TV PIN lock and instant QR code pairing</span>
            </div>
          </div>

          <GoogleSignInButton className="w-full" />
        </div>
      </div>
    );
  }

  // If user has zero spaces, prompt onboarding space creation
  if (spaces.length === 0) {
    return (
      <div className="min-h-screen bg-tv-bg flex items-center justify-center p-4">
        <OnboardingModal
          isOpen={true}
          user={user}
          onSubmit={async (name) => {
            setIsCreatingSpace(true);
            try {
              await createSpace(name);
            } finally {
              setIsCreatingSpace(false);
            }
          }}
          isSubmitting={isCreatingSpace}
        />
      </div>
    );
  }

  return <>{children}</>;
};
