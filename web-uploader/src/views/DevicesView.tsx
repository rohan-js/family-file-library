import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import type { Device } from '../types/models';
import { Tv, Lock, Unlock, ShieldAlert, Plus, Ban, CheckCircle2 } from 'lucide-react';
import { TvPinModal } from '../components/devices/TvPinModal';

export const DevicesView: React.FC = () => {
  const { activeSpace, isAdmin, refreshSpaces } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pinModalOpen, setPinModalOpen] = useState<boolean>(false);

  const fetchDevices = useCallback(async () => {
    if (!activeSpace) return;
    setLoading(true);
    setActionError(null);
    try {
      const { data, error } = await supabase
        .from('devices')
        .select('*')
        .eq('space_id', activeSpace.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDevices(data || []);
    } catch (err: any) {
      setActionError(err.message || 'Failed to load paired devices.');
    } finally {
      setLoading(false);
    }
  }, [activeSpace]);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  const handleRevokeDevice = async (deviceId: string, deviceName: string) => {
    if (!window.confirm(`Revoke access for "${deviceName}"? It will be immediately disconnected.`)) {
      return;
    }
    try {
      const { error } = await supabase
        .from('devices')
        .update({ is_revoked: true, updated_at: new Date().toISOString() })
        .eq('id', deviceId);

      if (error) throw error;
      fetchDevices();
    } catch (err: any) {
      setActionError(err.message || 'Failed to revoke device.');
    }
  };

  const hasPin = Boolean(activeSpace?.pin_hash);

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 text-tv-textLight">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-tv-border gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center space-x-2.5">
            <Tv className="w-7 h-7 text-tv-cyan" />
            <span>Paired Android TV Devices</span>
          </h1>
          <p className="text-sm text-tv-textMuted mt-1">
            Manage big-screen TVs connected to <strong className="text-tv-textLight">{activeSpace?.name}</strong>.
          </p>
        </div>

        <Link
          to="/pair"
          className="inline-flex items-center space-x-2 bg-tv-blue hover:bg-tv-blueHover text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-lg transition-all self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Pair New TV</span>
        </Link>
      </div>

      {actionError && (
        <div className="my-4 p-4 bg-tv-dangerBg border border-tv-danger/30 text-tv-danger rounded-xl text-sm">
          {actionError}
        </div>
      )}

      {/* Remote TV PIN Security Card */}
      <div className="my-6 p-6 bg-tv-card border border-tv-border rounded-2xl shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start space-x-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
            hasPin ? 'bg-tv-cyan/20 text-tv-cyan border border-tv-cyan/30' : 'bg-tv-elevated text-tv-textMuted'
          }`}>
            {hasPin ? <Lock className="w-6 h-6" /> : <Unlock className="w-6 h-6" />}
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="font-bold text-base text-tv-textLight">Remote TV PIN Lock</h3>
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${
                hasPin ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-tv-elevated text-tv-textMuted'
              }`}>
                {hasPin ? 'PIN Enabled' : 'No PIN Set'}
              </span>
            </div>
            <p className="text-xs text-tv-textMuted mt-1 max-w-lg">
              {hasPin
                ? 'Your Android TV requires this 4-digit PIN to unlock files and browse folders.'
                : 'Protect your family documents by setting a 4-digit PIN lock required on the Android TV remote.'}
            </p>
            {!isAdmin && (
              <p className="text-xs text-amber-400 mt-2 flex items-center space-x-1">
                <ShieldAlert className="w-3.5 h-3.5 inline" />
                <span>Only Space Owners and Admins can update the TV PIN.</span>
              </p>
            )}
          </div>
        </div>

        <button
          onClick={() => setPinModalOpen(true)}
          disabled={!isAdmin}
          className="px-4 py-2.5 bg-tv-elevated hover:bg-tv-border text-tv-textLight text-xs font-semibold rounded-xl border border-tv-border shadow disabled:opacity-40 transition-colors self-start md:self-auto flex-shrink-0"
        >
          {hasPin ? 'Change PIN' : 'Set TV PIN'}
        </button>
      </div>

      {/* Paired Hardware Devices List */}
      <h2 className="text-base font-bold text-tv-textLight mb-3">Hardware Device Registry</h2>

      {loading ? (
        <div className="text-center py-12 text-tv-textMuted text-sm">Loading paired devices...</div>
      ) : devices.length === 0 ? (
        <div className="text-center py-16 bg-tv-card rounded-2xl border border-tv-border">
          <Tv className="w-12 h-12 text-tv-textMuted/40 mx-auto mb-3" />
          <h3 className="font-semibold text-tv-textLight">No Android TVs Paired</h3>
          <p className="text-xs text-tv-textMuted mt-1 max-w-xs mx-auto mb-4">
            Connect your living room TV or bedroom display using a 6-digit code or QR scan.
          </p>
          <Link
            to="/pair"
            className="inline-flex items-center space-x-2 text-xs font-semibold bg-tv-cyan/20 hover:bg-tv-cyan/30 text-tv-cyan px-4 py-2 rounded-lg border border-tv-cyan/40 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Pair Android TV Now</span>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {devices.map((device) => {
            const isRevoked = device.is_revoked;
            return (
              <div
                key={device.id}
                className="flex items-center justify-between p-4 bg-tv-card border border-tv-border rounded-xl shadow"
              >
                <div className="flex items-center space-x-3.5 truncate">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    isRevoked ? 'bg-tv-dangerBg text-tv-danger' : 'bg-tv-elevated text-tv-cyan'
                  }`}>
                    <Tv className="w-5 h-5" />
                  </div>
                  <div className="truncate">
                    <div className="flex items-center space-x-2 truncate">
                      <span className="font-semibold text-sm truncate">{device.device_name}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                        isRevoked ? 'bg-tv-dangerBg text-tv-danger' : 'bg-emerald-500/20 text-emerald-400'
                      }`}>
                        {isRevoked ? 'Revoked' : 'Active'}
                      </span>
                    </div>
                    <p className="text-xs text-tv-textMuted mt-0.5 font-mono truncate">
                      ID: {device.device_identifier} • Paired {new Date(device.paired_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-3 flex-shrink-0">
                  {!isRevoked && isAdmin && (
                    <button
                      onClick={() => handleRevokeDevice(device.id, device.device_name)}
                      className="p-2 text-tv-textMuted hover:text-tv-danger hover:bg-tv-dangerBg rounded-lg transition-colors text-xs flex items-center space-x-1"
                      title="Revoke Device Access"
                    >
                      <Ban className="w-4 h-4" />
                      <span className="hidden sm:inline">Revoke</span>
                    </button>
                  )}
                  {!isRevoked && !isAdmin && (
                    <span className="text-xs text-tv-textMuted flex items-center space-x-1">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span className="hidden sm:inline">Connected</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TV PIN Modal */}
      {activeSpace && (
        <TvPinModal
          isOpen={pinModalOpen}
          spaceId={activeSpace.id}
          hasExistingPin={hasPin}
          onClose={() => setPinModalOpen(false)}
          onSuccess={async () => {
            await refreshSpaces();
          }}
        />
      )}
    </div>
  );
};
