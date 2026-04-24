import { ElementVisualStyle, GlobalDesignStyles } from '../types';
import type { CSSProperties } from 'react';

export const DEFAULT_PALETTE = ['#3D2B1F', '#89CFF0', '#F5F5DC', '#FFFFFF'];

export const DEFAULT_GLOBAL_STYLES: GlobalDesignStyles = {
  backgroundColor: 'var(--global-background-color, #F5F5DC)', // 默認為米色
  backgroundRepeat: 'no-repeat',
  backgroundSize: 'cover',
  fontFamily: 'system',
  palette: DEFAULT_PALETTE,
  textColor: '#3D2B1F',
  componentBackgroundColor: '#FFFFFF',
  componentBorderColor: '#3D2B1F',
};

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
  const next: CSSProperties = {};

  if (style.backgroundColor) {
    next.backgroundColor = withAlpha(style.backgroundColor, style.backgroundOpacity ?? 1);
  }

  if (style.borderColor) {
    next.borderColor = style.borderColor;
  }
  if (typeof style.borderWidth === 'number') {
    next.borderWidth = style.borderWidth;
  }
  if (style.borderStyle) {
    next.borderStyle = style.borderStyle === 'wavy' ? 'solid' : style.borderStyle;
  }
  if (typeof style.radius === 'number') {
    next.borderRadius = `${style.radius}px`;
  }
  if (style.textAlign) {
    next.textAlign = style.textAlign;
  }

  return next;
}

export function normalizeSectionAnchor(raw: string): string {
  const cleaned = raw.trim().replace(/^#+/, '');
  if (!cleaned) return '';
  return `#${cleaned.replace(/\s+/g, '-')}`;
}

export function isHashLink(url?: string): boolean {
  return typeof url === 'string' && /^#([a-zA-Z0-9_-]+)?$/.test(url.trim());
}

export function normalizeLinkTarget(raw?: string): string {
  const value = (raw || '').trim();
  if (!value) return '#';
  if (value === '#') return '#';
  if (isHashLink(value)) return value;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  return `https://${value}`;
}

export function resolveGlobalStyles(input?: Partial<GlobalDesignStyles>): GlobalDesignStyles {
  return {
    ...DEFAULT_GLOBAL_STYLES,
    ...(input || {}),
    palette: (input?.palette && input.palette.length > 0 ? input.palette : DEFAULT_PALETTE).slice(0, 10),
  };
}

export function getFontFamily(fontFamily?: GlobalDesignStyles['fontFamily']): string {
  switch (fontFamily) {
    case 'noto-sans-tc':
      return '"Noto Sans TC", "Inter", sans-serif';
    case 'noto-serif-tc':
      return '"Noto Serif TC", serif';
    case 'chiron-goround-tc':
      return '"M PLUS Rounded 1c", "Noto Sans TC", sans-serif';
    case 'lxgw-wenkai-tc':
      return '"LXGW WenKai TC", serif';
    default:
      return '"Inter", ui-sans-serif, system-ui, sans-serif';
  }
}

export function toGlobalPageStyle(styles?: Partial<GlobalDesignStyles>): CSSProperties {
  const resolved = resolveGlobalStyles(styles);
  const backgroundSize = resolved.backgroundSize === 'stretch' ? '100% 100%' : resolved.backgroundSize;

  return {
    backgroundColor: resolved.backgroundColor,
    backgroundImage: resolved.backgroundImageUrl ? `url(${resolved.backgroundImageUrl})` : undefined,
    backgroundRepeat: resolved.backgroundImageUrl ? resolved.backgroundRepeat : undefined,
    backgroundSize: resolved.backgroundImageUrl ? backgroundSize : undefined,
    backgroundPosition: resolved.backgroundImageUrl ? 'left top' : undefined,
    color: resolved.textColor,
    fontFamily: getFontFamily(resolved.fontFamily),
  };
}
