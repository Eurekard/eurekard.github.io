/**
 * api/analytics-report.ts
 * Vercel Serverless Function – GA4 Data API proxy.
 *
 * GET /api/analytics-report?uid=<cardOwnerUid>&days=7|30
 *
 * Required environment variables (set in Vercel dashboard):
 *   GA4_PROPERTY_ID       – numeric property ID (e.g. "123456789")
 *   GA4_SERVICE_ACCOUNT_JSON – full contents of the service account JSON key file
 *
 * The service account must have the role:
 *   "Viewer" on the GA4 property  (GA4 > Admin > Property Access Management)
 */

import { BetaAnalyticsDataClient } from '@google-analytics/data';

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export default async function handler(req: any, res: any) {
  // Only allow GET
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const uid = typeof req.query?.uid === 'string' ? req.query.uid.trim() : '';
  const daysParam = req.query?.days;
  const days = daysParam === '30' ? 30 : 7;

  if (!uid) {
    res.status(400).json({ error: 'Missing uid parameter' });
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

    // Run a batch request: one report for totals, one for the trend timeline
    const [totalsResponse, timelineResponse, sourcesResponse] = await Promise.all([
      // --- 1) Totals: views + clicks ---
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        metrics: [
          { name: 'screenPageViews' },    // page_view events
          { name: 'eventCount' },          // all events (including select_content/clicks)
        ],
        dimensionFilter: {
          filter: {
            fieldName: 'customEvent:card_owner_uid',
            stringFilter: { matchType: 'EXACT', value: uid },
          },
        },
      }),

      // --- 2) Daily timeline for the chart ---
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'eventCount' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        dimensionFilter: {
          filter: {
            fieldName: 'customEvent:card_owner_uid',
            stringFilter: { matchType: 'EXACT', value: uid },
          },
        },
      }),

      // --- 3) Traffic sources ---
      client.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'screenPageViews' }],
        dimensionFilter: {
          filter: {
            fieldName: 'customEvent:card_owner_uid',
            stringFilter: { matchType: 'EXACT', value: uid },
          },
        },
      }),
    ]);

    // Parse totals
    const totalsRow = totalsResponse[0]?.rows?.[0];
    const totalViews = parseInt(totalsRow?.metricValues?.[0]?.value || '0', 10);
    const totalAllEvents = parseInt(totalsRow?.metricValues?.[1]?.value || '0', 10);
    // Clicks = all events minus page_view events
    const totalClicks = Math.max(0, totalAllEvents - totalViews);

    // Parse daily timeline
    const trend = (timelineResponse[0]?.rows || []).map((row) => {
      const rawDate = row.dimensionValues?.[0]?.value || ''; // YYYYMMDD
      const views = parseInt(row.metricValues?.[0]?.value || '0', 10);
      const allEvts = parseInt(row.metricValues?.[1]?.value || '0', 10);
      const clicks = Math.max(0, allEvts - views);
      // Format as M/D
      const y = rawDate.slice(0, 4);
      const m = rawDate.slice(4, 6);
      const d = rawDate.slice(6, 8);
      return { name: `${parseInt(m)}/${parseInt(d)}`, date: `${y}-${m}-${d}`, views, clicks };
    });

    // Fill in missing days with zeroes
    const filledTrend = buildFilledDays(days, trend);

    // Parse traffic sources
    const GA4_SOURCE_MAP: Record<string, string> = {
      'Organic Search': 'search',
      'Paid Search': 'search',
      'Direct': 'direct',
      'Organic Social': 'social',
      'Paid Social': 'social',
      'Referral': 'referral',
      'Email': 'referral',
      '(Other)': 'unknown',
    };

    const sourceAccum: Record<string, number> = {
      direct: 0, social: 0, search: 0, referral: 0, unknown: 0,
    };

    (sourcesResponse[0]?.rows || []).forEach((row) => {
      const ga4Channel = row.dimensionValues?.[0]?.value || '';
      const count = parseInt(row.metricValues?.[0]?.value || '0', 10);
      const key = GA4_SOURCE_MAP[ga4Channel] || 'unknown';
      sourceAccum[key] = (sourceAccum[key] || 0) + count;
    });

    const totalSourceViews = Object.values(sourceAccum).reduce((a, b) => a + b, 0);
    const SOURCE_LABEL_MAP: Record<string, string> = {
      direct: '直接流量', social: '社群來源', search: '搜尋引擎',
      referral: '引薦網站', unknown: '其他',
    };
    const SOURCE_COLOR_MAP: Record<string, string> = {
      direct: 'bg-cat-blue', social: 'bg-pink-400', search: 'bg-chocolate',
      referral: 'bg-blue-600', unknown: 'bg-gray-400',
    };

    const sources = Object.entries(sourceAccum)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([key, count]) => ({
        label: SOURCE_LABEL_MAP[key],
        percentage: totalSourceViews > 0 ? Math.round((count / totalSourceViews) * 100) : 0,
        color: SOURCE_COLOR_MAP[key],
      }));

    res.status(200).json({
      views: totalViews,
      clicks: totalClicks,
      trend: filledTrend,
      sources: sources.length > 0 ? sources : [{ label: '直接流量', percentage: 0, color: 'bg-cat-blue' }],
      // GA4 does not provide device breakdown per custom dimension easily without additional reports
      // Using placeholder; extend later if needed
      desktopRate: 0,
      mobileRate: 0,
      dataDelayNote: 'GA4 data may be delayed 24-48h',
    });
  } catch (err: any) {
    console.error('GA4 API error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics', detail: err.message });
  }
}

/** Fill in zeroes for any days missing from the GA4 response */
function buildFilledDays(days: number, trend: { name: string; date: string; views: number; clicks: number }[]) {
  const result: { name: string; views: number; clicks: number }[] = [];
  const dataByDate = new Map(trend.map((t) => [t.date, t]));

  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateKey = `${y}-${m}-${day}`;
    const entry = dataByDate.get(dateKey);
    result.push({
      name: `${parseInt(m)}/${parseInt(day)}`,
      views: entry?.views ?? 0,
      clicks: entry?.clicks ?? 0,
    });
  }
  return result;
}
