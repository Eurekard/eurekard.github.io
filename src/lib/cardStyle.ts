import { ElementVisualStyle } from '../types';
import type { CSSProperties } from 'react';

export const DEFAULT_PALETTE = ['#3D2B1F', '#89CFF0', '#F5F5DC', '#FFFFFF'];

export function normalizeOpacity(opacity?: number): number {
  if (typeof opacity !== 'number' || Number.isNaN(opacity)) return 1;
  return Math.min(1, Math.max(0, opacity));
}

export function withAlpha(hex: string, alpha = 1): string {
  const value = hex.replace('#', '').trim();
  if (value.length !== 6) return hex;
  const normalizedAlpha = normalizeOpacity(alpha);
  const alphaHex = Math.round(normalizedAlpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${value}${alphaHex}`;
}

export function toElementStyle(style?: ElementVisualStyle): CSSProperties {
  if (!style) return {};

  return {
    backgroundColor: style.backgroundColor
      ? withAlpha(style.backgroundColor, style.backgroundOpacity ?? 1)
      : undefined,
    borderColor: style.borderColor,
    borderWidth: style.borderWidth ?? 0,
    borderStyle: style.borderStyle === 'wavy' ? 'solid' : style.borderStyle,
    borderRadius: typeof style.radius === 'number' ? `${style.radius}px` : undefined,
    textAlign: style.textAlign,
  };
}

export function normalizeSectionAnchor(raw: string): string {
  const cleaned = raw.trim().replace(/^#+/, '');
  if (!cleaned) return '';
  return `#${cleaned.replace(/\s+/g, '-')}`;
}

export function isHashLink(url?: string): boolean {
  return typeof url === 'string' && /^#[a-zA-Z0-9_-]+$/.test(url.trim());
}
