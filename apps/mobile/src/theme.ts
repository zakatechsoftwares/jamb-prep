/**
 * Design system and visual tokens for the JAMB UTME Prep mobile client.
 * Engineered for mobile legibility, clear academic visual hierarchy,
 * and high-contrast accessibility under direct sunlight on entry-level Android devices.
 */

export const colors = {
  // Brand & Accent Colors
  primary: '#1d4ed8', // Vivid Cobalt
  primaryDark: '#1e40af',
  primaryLight: '#eff6ff',
  primaryBorder: '#bfdbfe',

  brandNavy: '#0f172a', // Deep Academic Navy
  brandEmerald: '#059669', // Nigerian Emerald / Academic Excellence
  brandEmeraldLight: '#ecfdf5',
  brandEmeraldBorder: '#a7f3d0',

  // Status & Feedback Colors
  success: '#16a34a',
  successLight: '#f0fdf4',
  successBorder: '#86efac',

  warning: '#d97706',
  warningLight: '#fffbeb',
  warningBorder: '#fde68a',

  danger: '#dc2626',
  dangerLight: '#fef2f2',
  dangerBorder: '#fecaca',

  // Neutral & Surface Colors
  background: '#f8fafc',
  surface: '#ffffff',
  surfaceAlt: '#f1f5f9',
  surfaceHighlight: '#f8fafc',

  border: '#e2e8f0',
  borderDark: '#cbd5e1',

  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#64748b',
  textInverted: '#ffffff',
};

export const radii = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
};

export const shadows = {
  subtle: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  card: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  floating: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
};

export const typography = {
  hero: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  h1: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  h2: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  h3: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  body: {
    fontSize: 15,
    fontWeight: '400' as const,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  bodySecondary: {
    fontSize: 14,
    fontWeight: '400' as const,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  caption: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: colors.textMuted,
  },
};
