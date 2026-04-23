export type AnalyticsEventType = 'view' | 'click';
export type AnalyticsDevice = 'mobile' | 'desktop';
export type AnalyticsSource = 'direct' | 'social' | 'search' | 'referral' | 'unknown';

export function getAnalyticsDay(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function detectDevice(): AnalyticsDevice {
  if (typeof window === 'undefined') return 'desktop';
  return window.matchMedia('(max-width: 768px)').matches ? 'mobile' : 'desktop';
}

export function detectSource(referrer: string): AnalyticsSource {
  if (!referrer) return 'direct';

  try {
    const host = new URL(referrer).hostname.toLowerCase();
    if (host.includes('google.') || host.includes('bing.') || host.includes('yahoo.') || host.includes('duckduckgo.')) {
      return 'search';
    }

    if (host.includes('instagram.') || host.includes('facebook.') || host.includes('twitter.') || host.includes('x.com') || host.includes('tiktok.')) {
      return 'social';
    }

    return 'referral';
  } catch {
    return 'unknown';
  }
}

export function formatShortDate(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return day;
  return `${month}/${date}`;
}

export function buildRecentDays(count: number): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i -= 1) {
    const current = new Date(now);
    current.setDate(now.getDate() - i);
    days.push(getAnalyticsDay(current));
  }
  return days;
}
