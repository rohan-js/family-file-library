import React from 'react';

export function sanitizePairingCode(input: string): string {
  // Convert to uppercase, strip all whitespace, hyphens, and invalid non-alphanumeric chars
  return input
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

export function formatPairingDisplay(sanitized: string): string {
  if (sanitized.length <= 3) return sanitized;
  return `${sanitized.slice(0, 3)}-${sanitized.slice(3, 6)}`;
}

interface PairingCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export const PairingCodeInput: React.FC<PairingCodeInputProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const sanitized = sanitizePairingCode(raw);
    onChange(sanitized);
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={formatPairingDisplay(value)}
        onChange={handleChange}
        disabled={disabled}
        placeholder="ABC-DEF"
        maxLength={7} // "ABC-DEF"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck="false"
        className="w-full text-center text-3xl font-mono tracking-widest font-bold bg-tv-bg border-2 border-tv-border rounded-xl py-3 px-4 text-tv-cyan placeholder-tv-textMuted/40 focus:outline-none focus:border-tv-cyan focus:ring-2 focus:ring-tv-cyan/20 disabled:opacity-50 transition-all uppercase"
      />
    </div>
  );
};
