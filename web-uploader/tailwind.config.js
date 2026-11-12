/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        tv: {
          bg: '#0F172A',         // Slate 900 (Main TV & PWA background)
          card: '#1E293B',       // Slate 800 (Card & Modal surfaces)
          elevated: '#334155',   // Slate 700 (Hover & active states)
          border: '#334155',     // Subtle border outline
          cyan: '#00E5FF',       // High-contrast accent / active focus
          'cyan-glow': 'rgba(0, 229, 255, 0.25)',
          blue: '#3B82F6',       // Primary action button
          blueHover: '#2563EB',
          textMuted: '#94A3B8',  // Slate 400
          textLight: '#F8FAFC',  // Slate 50
          danger: '#EF4444',     // Red 500 (Delete / Over-limit error)
          dangerBg: 'rgba(239, 68, 68, 0.15)',
          warning: '#F59E0B',    // Amber 500 (Trash countdown warning)
          warningBg: 'rgba(245, 158, 11, 0.15)',
          success: '#10B981',    // Emerald 500 (Upload complete)
          successBg: 'rgba(16, 185, 129, 0.15)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      screens: {
        xs: '480px',
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
      },
    },
  },
  plugins: [],
};
