import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import * as fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

/** Dev-only plugin: handles /api/analytics-report locally using GA4 credentials from .env.local */
function localApiPlugin() {
  // For local dev: read SA JSON file directly (same file already in Downloads folder)
  const GA4_PROPERTY_ID = '534431559';
  let credentials: Record<string, unknown> | null = null;

  // The SA key file sits one folder up from the project root (in Downloads/)
  const saPath = path.resolve(process.cwd(), '../gen-lang-client-0158304921-3cc3f5a6b937.json');
  try {
    credentials = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
    console.log('[local-api] ✅ GA4 credentials loaded from', saPath);
    console.log('[local-api] ✅ GA4_PROPERTY_ID:', GA4_PROPERTY_ID);
  } catch {
    console.error('[local-api] ❌ Could not load SA JSON from', saPath, '— check file exists');
  }

  return {
    name: 'local-api',
    configureServer(server: any) {
      server.middlewares.use('/api/analytics-report', async (req: any, res: any) => {
        const reply = (status: number, body: unknown) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        };

        try {
          if (!GA4_PROPERTY_ID || !credentials) {
            return reply(500, { error: 'GA4 credentials not loaded — check console for details' });
          }

          const { BetaAnalyticsDataClient } = await import('@google-analytics/data');
          const client = new BetaAnalyticsDataClient({ credentials });
          const property = `properties/${GA4_PROPERTY_ID}`;

          const qs = new URL(req.url, 'http://localhost').searchParams;
          const username = qs.get('username') ?? '';
          const displayName = qs.get('displayName') ?? '';
          const days = qs.get('days') === '30' ? 30 : 7;

          const pathFilter = username ? {
            dimensionFilter: {
              filter: {
                fieldName: 'pagePath',
                stringFilter: { matchType: 'BEGINS_WITH' as const, value: `/${username}` },
              },
            },
          } : {};

          const [totalsRes, timelineRes, sourcesRes, realtimeRes] = await Promise.all([
            client.runReport({
              property,
              dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
              metrics: [{ name: 'screenPageViews' }, { name: 'eventCount' }],
              ...pathFilter,
            }),
            client.runReport({
              property,
              dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
              dimensions: [{ name: 'date' }],
              metrics: [{ name: 'screenPageViews' }, { name: 'eventCount' }],
              orderBys: [{ dimension: { dimensionName: 'date' } }],
              ...pathFilter,
            }),
            client.runReport({
              property,
              dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
              dimensions: [{ name: 'sessionDefaultChannelGroup' }],
              metrics: [{ name: 'screenPageViews' }],
              ...pathFilter,
            }),
            client.runRealtimeReport({
              property,
              dimensions: [{ name: 'unifiedScreenName' }],
              metrics: [{ name: 'activeUsers' }, { name: 'eventCount' }],
            }),
          ]);

          const totalsRow = totalsRes[0]?.rows?.[0];
          const totalViews = parseInt(totalsRow?.metricValues?.[0]?.value || '0', 10);
          const totalAllEvents = parseInt(totalsRow?.metricValues?.[1]?.value || '0', 10);

          const allRtRows = realtimeRes[0]?.rows || [];
          const rtRows = displayName
            ? allRtRows.filter((r: any) => {
                const sn = r.dimensionValues?.[0]?.value || '';
                return sn === displayName || sn.startsWith(displayName + ' |') || sn.startsWith(displayName + '|');
              })
            : allRtRows;
          const realtimeActiveUsers = rtRows.reduce((s: number, r: any) => s + parseInt(r.metricValues?.[0]?.value || '0', 10), 0);
          const realtimeAllEvents = rtRows.reduce((s: number, r: any) => s + parseInt(r.metricValues?.[1]?.value || '0', 10), 0);

          const trend = (timelineRes[0]?.rows || []).map((row: any) => {
            const rawDate = row.dimensionValues?.[0]?.value || '';
            const v = parseInt(row.metricValues?.[0]?.value || '0', 10);
            const a = parseInt(row.metricValues?.[1]?.value || '0', 10);
            const m = rawDate.slice(4, 6); const d = rawDate.slice(6, 8); const y = rawDate.slice(0, 4);
            return { name: `${parseInt(m)}/${parseInt(d)}`, date: `${y}-${m}-${d}`, views: v, clicks: Math.max(0, a - v) };
          });

          const byDate = new Map(trend.map((t: any) => [t.date, t]));
          const filledTrend = [];
          const now = new Date();
          for (let i = days - 1; i >= 0; i--) {
            const d = new Date(now); d.setDate(now.getDate() - i);
            const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0');
            const key = `${y}-${m}-${day}`; const e = byDate.get(key) as any;
            filledTrend.push({ name: `${parseInt(m)}/${parseInt(day)}`, views: e?.views ?? 0, clicks: e?.clicks ?? 0 });
          }

          const SOURCE_MAP: Record<string, string> = { 'Organic Search': 'search', 'Paid Search': 'search', 'Direct': 'direct', 'Organic Social': 'social', 'Paid Social': 'social', 'Referral': 'referral', 'Email': 'referral', '(Other)': 'unknown' };
          const SOURCE_LABEL: Record<string, string> = { direct: '直接流量', social: '社群來源', search: '搜尋引擎', referral: '引薦網站', unknown: '其他' };
          const SOURCE_COLOR: Record<string, string> = { direct: 'bg-cat-blue', social: 'bg-pink-400', search: 'bg-chocolate', referral: 'bg-blue-600', unknown: 'bg-gray-400' };
          const accum: Record<string, number> = { direct: 0, social: 0, search: 0, referral: 0, unknown: 0 };
          (sourcesRes[0]?.rows || []).forEach((row: any) => {
            const k = SOURCE_MAP[row.dimensionValues?.[0]?.value || ''] || 'unknown';
            accum[k] = (accum[k] || 0) + parseInt(row.metricValues?.[0]?.value || '0', 10);
          });
          const total = Object.values(accum).reduce((a, b) => a + b, 0);
          const sources = Object.entries(accum).filter(([, c]) => c > 0).sort(([, a], [, b]) => b - a)
            .map(([k, c]) => ({ label: SOURCE_LABEL[k], percentage: total > 0 ? Math.round((c / total) * 100) : 0, color: SOURCE_COLOR[k] }));

          reply(200, {
            views: totalViews,
            clicks: Math.max(0, totalAllEvents - totalViews),
            desktopRate: 0, mobileRate: 0,
            trend: filledTrend,
            sources: sources.length > 0 ? sources : [{ label: '直接流量', percentage: 0, color: 'bg-cat-blue' }],
            realtimeViews: realtimeActiveUsers,
            realtimeClicks: Math.max(0, realtimeAllEvents - realtimeActiveUsers),
            realtimeActiveUsers,
            dataDelayNote: 'Historical data delayed 24-48h; realtime stats reflect last 30 minutes',
          });
        } catch (err: any) {
          reply(500, { error: err.message || String(err) });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localApiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'node-fetch': path.resolve(__dirname, 'src/empty.js'),
      'formdata-polyfill': path.resolve(__dirname, 'src/empty.js'),
      'formdata-polyfill/esm.min.js': path.resolve(__dirname, 'src/empty.js'),
    },
  },
  optimizeDeps: {
    exclude: ['@google/genai', 'node-fetch', 'formdata-polyfill', '@google-analytics/data'],
  },
  server: {
    host: true,
    port: 3000,
    hmr: process.env.DISABLE_HMR !== 'true',
  },
});