/**
 * api/analytics-report.ts
 * Vercel Serverless Function – GA4 Data API proxy.
 *
 * GET /api/analytics-report?uid=<cardOwnerUid>&days=7|30&username=<username>
 *
 * Returns:
 *   - realtimeViews / realtimeActiveUsers  (last 30 min, from runRealtimeReport)
 *   - views / clicks                       (historical totals, from runReport, 24-48h delay)
 *   - trend[]                              (daily breakdown, from runReport)
 *   - sources[]                            (traffic channels, from runReport)
 *
 * Required environment variables (Vercel dashboard):
 *   GA4_PROPERTY_ID          – numeric property ID (e.g. "534431559")
 *   GA4_SERVICE_ACCOUNT_JSON – full JSON key file contents
 */

import { BetaAnalyticsDataClient } from '@google-analytics/data';

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const uid = typeof req.query?.uid === 'string' ? req.query.uid.trim() : '';
  const username = typeof req.query?.username === 'string' ? req.query.username.trim() : '';
  const daysParam = req.query?.days;
  const days = daysParam === '30' ? 30 : 7;

  if (!uid && !username) {
    res.status(400).json({ error: 'Missing uid or username parameter' });
    return;
  }

  let propertyId: string;
  let credentials: object;

  try {
    propertyId = getRequiredEnv('GA4_PROPERTY_ID');
    credentials = JSON.parse(getRequiredEnv('GA4_SERVICE_ACCOUNT_JSON'));
  } catch (err: any) {
    console.error('GA4 env config error:', err.message);
    res.status(500).json({ error: 'Analytics not configured on server', detail: err.message });
    return;
  }

  try {
    const client = new BetaAnalyticsDataClient({ credentials });
    const property = `properties/${propertyId}`;

    // pagePath filter (standard dimension, works without custom registration)
    const pathFilter = username ? {
      dimensionFilter: {
        filter: {
          fieldName: 'pagePath',
          stringFilter: { matchType: 'BEGINS_WITH' as const, value: `/${username}` },
        },
      },
    } : {};

    // ── Run all reports in parallel ─────────────────────────────────────────
    const [totalsRes, timelineRes, sourcesRes, realtimeRes] = await Promise.all([

      // 1) Historical totals (24-48h delay, covers full period)
      client.runReport({
        property,
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'eventCount' }],
        ...pathFilter,
      }),

      // 2) Daily trend timeline
      client.runReport({
        property,
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'eventCount' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        ...pathFilter,
      }),

      // 3) Traffic channel sources
      client.runReport({
        property,
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'screenPageViews' }],
        ...pathFilter,
      }),

      // 4. Realtime report – last 30 minutes (~5 min freshness, no 24-48h delay)
      //    pagePath/unifiedPageScreen are NOT valid realtime dimensions.
      //    unifiedScreenName works but maps to page title, not path.
      //    → Query property-wide (no filter) for reliable cross-browser data.
      client.runRealtimeReport({
        property,
        dimensions: [{ name: 'unifiedScreenName' }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'eventCount' },
        ],
      }),
    ]);

    // ── Parse historical totals ──────────────────────────────────────────────
    const totalsRow = totalsRes[0]?.rows?.[0];
    const totalViews = parseInt(totalsRow?.metricValues?.[0]?.value || '0', 10);
    const totalAllEvents = parseInt(totalsRow?.metricValues?.[1]?.value || '0', 10);
    const totalClicks = Math.max(0, totalAllEvents - totalViews);

    // ── Parse realtime stats ─────────────────────────────────────────────────
    // rows are grouped by unifiedScreenName (page title) — sum across all pages
    const rtRows = realtimeRes[0]?.rows || [];
    const realtimeActiveUsers = rtRows.reduce((s, r) => s + parseInt(r.metricValues?.[0]?.value || '0', 10), 0);
    const realtimeAllEvents = rtRows.reduce((s, r) => s + parseInt(r.metricValues?.[1]?.value || '0', 10), 0);
    // eventCount includes page_view events; approximate views ≈ activeUsers for realtime
    const realtimeViews = realtimeActiveUsers;
    const realtimeClicks = Math.max(0, realtimeAllEvents - realtimeActiveUsers);


    // ── Parse daily trend ────────────────────────────────────────────────────
    const trend = (timelineRes[0]?.rows || []).map((row) => {
      const rawDate = row.dimensionValues?.[0]?.value || '';
      const v = parseInt(row.metricValues?.[0]?.value || '0', 10);
      const a = parseInt(row.metricValues?.[1]?.value || '0', 10);
      const m = rawDate.slice(4, 6);
      const d = rawDate.slice(6, 8);
      const y = rawDate.slice(0, 4);
      return { name: `${parseInt(m)}/${parseInt(d)}`, date: `${y}-${m}-${d}`, views: v, clicks: Math.max(0, a - v) };
    });

    const filledTrend = buildFilledDays(days, trend);

    // ── Parse traffic sources ────────────────────────────────────────────────
    const GA4_SOURCE_MAP: Record<string, string> = {
      'Organic Search': 'search', 'Paid Search': 'search',
      'Direct': 'direct', 'Organic Social': 'social', 'Paid Social': 'social',
      'Referral': 'referral', 'Email': 'referral', '(Other)': 'unknown',
    };
    const sourceAccum: Record<string, number> = { direct: 0, social: 0, search: 0, referral: 0, unknown: 0 };
    (sourcesRes[0]?.rows || []).forEach((row) => {
      const ch = row.dimensionValues?.[0]?.value || '';
      const cnt = parseInt(row.metricValues?.[0]?.value || '0', 10);
      const key = GA4_SOURCE_MAP[ch] || 'unknown';
      sourceAccum[key] = (sourceAccum[key] || 0) + cnt;
    });

    const totalSrcViews = Object.values(sourceAccum).reduce((a, b) => a + b, 0);
    const SOURCE_LABEL: Record<string, string> = { direct: '直接流量', social: '社群來源', search: '搜尋引擎', referral: '引薦網站', unknown: '其他' };
    const SOURCE_COLOR: Record<string, string> = { direct: 'bg-cat-blue', social: 'bg-pink-400', search: 'bg-chocolate', referral: 'bg-blue-600', unknown: 'bg-gray-400' };

    const sources = Object.entries(sourceAccum)
      .filter(([, c]) => c > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([k, c]) => ({
        label: SOURCE_LABEL[k],
        percentage: totalSrcViews > 0 ? Math.round((c / totalSrcViews) * 100) : 0,
        color: SOURCE_COLOR[k],
      }));

    res.status(200).json({
      // Historical (24-48h delay)
      views: totalViews,
      clicks: totalClicks,
      trend: filledTrend,
      sources: sources.length > 0 ? sources : [{ label: '直接流量', percentage: 0, color: 'bg-cat-blue' }],
      desktopRate: 0,
      mobileRate: 0,
      // Realtime (last 30 min, ~5 min freshness)
      realtimeViews,
      realtimeClicks,
      realtimeActiveUsers,
      dataDelayNote: 'Historical data delayed 24-48h; realtime stats reflect last 30 minutes',
    });
  } catch (err: any) {
    console.error('GA4 API error:', err);
    const detail = err?.message || String(err);
    const code = err?.code || err?.status || 'UNKNOWN';
    res.status(500).json({
      error: 'Failed to fetch analytics',
      detail,
      code,
      hint: code === 7 || String(code) === '7'
        ? 'PERMISSION_DENIED: The service account does not have access to this GA4 property.'
        : code === 5 || String(code) === '5'
        ? 'NOT_FOUND: Check GA4_PROPERTY_ID is correct (numeric ID from GA4 Admin → Property Settings).'
        : undefined,
    });
  }
}

function buildFilledDays(days: number, trend: { name: string; date: string; views: number; clicks: number }[]) {
  const result: { name: string; views: number; clicks: number }[] = [];
  const byDate = new Map(trend.map((t) => [t.date, t]));
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}`;
    const e = byDate.get(key);
    result.push({ name: `${parseInt(m)}/${parseInt(day)}`, views: e?.views ?? 0, clicks: e?.clicks ?? 0 });
  }
  return result;
}
