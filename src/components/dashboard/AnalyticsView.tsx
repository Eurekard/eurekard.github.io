import React, { useEffect, useMemo, useState } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Eye, MousePointer2, Smartphone, Monitor, Globe, AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { db } from '../../lib/firebase';
import { onSnapshot, collection } from 'firebase/firestore';

type TrendPoint = { name: string; views: number; clicks: number };
type SourceRow = { label: string; percentage: number; color: string };

type AnalyticsReport = {
  views: number;
  clicks: number;
  desktopRate: number;
  mobileRate: number;
  trend: TrendPoint[];
  sources: SourceRow[];
  dataDelayNote?: string;
  // Realtime (last 30 min, ~5 min freshness)
  realtimeViews: number;
  realtimeClicks: number;
  realtimeActiveUsers: number;
};

export default function AnalyticsView({ cardId, username }: { cardId: string; username?: string }) {
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rangeDays, setRangeDays] = useState<7 | 30>(7);
  const [responseCount, setResponseCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Auto-refresh every 5 minutes (matching GA4 realtime update cadence)
  useEffect(() => {
    const interval = setInterval(() => fetchReport(), 5 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, rangeDays]);

  // Response count stays real-time via Firestore (unrelated to traffic analytics)
  useEffect(() => {
    if (!cardId || cardId === 'demo_user') return;
    const unsub = onSnapshot(collection(db, 'cards', cardId, 'responses'), (snap) => {
      setResponseCount(snap.size);
    });
    return () => unsub();
  }, [cardId]);

  const fetchReport = async () => {
    if (!cardId || cardId === 'demo_user') {
      const days: TrendPoint[] = [];
      const now = new Date();
      for (let i = rangeDays - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        days.push({ name: `${d.getMonth() + 1}/${d.getDate()}`, views: 0, clicks: 0 });
      }
      setReport({ views: 0, clicks: 0, desktopRate: 0, mobileRate: 0, trend: days, sources: [{ label: '直接流量', percentage: 0, color: 'bg-cat-blue' }], realtimeViews: 0, realtimeClicks: 0, realtimeActiveUsers: 0 });
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ uid: cardId, days: String(rangeDays) });
      if (username) params.set('username', username);
      const res = await fetch(`/api/analytics-report?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = [body.error, body.detail, body.hint].filter(Boolean).join(' — ');
        throw new Error(msg || `HTTP ${res.status}`);
      }
      const data: AnalyticsReport = await res.json();
      setReport(data);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, rangeDays]);

  const ctr = useMemo(() => {
    if (!report?.views) return 0;
    return Number(((report.clicks / report.views) * 100).toFixed(1));
  }, [report]);

  const views = report?.views ?? 0;
  const clicks = report?.clicks ?? 0;
  const desktopRate = report?.desktopRate ?? 0;
  const mobileRate = report?.mobileRate ?? 0;
  const trend = report?.trend ?? [];
  const sources = report?.sources ?? [{ label: '直接流量', percentage: 0, color: 'bg-cat-blue' }];
  const realtimeViews = report?.realtimeViews ?? 0;
  const realtimeClicks = report?.realtimeClicks ?? 0;
  const realtimeActiveUsers = report?.realtimeActiveUsers ?? 0;

  const updatedStr = lastUpdated
    ? `${lastUpdated.getHours().toString().padStart(2,'0')}:${lastUpdated.getMinutes().toString().padStart(2,'0')}`
    : null;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      {/* GA4 Status Banner */}
      <div className="flex items-center gap-3 px-5 py-3 bg-cat-blue/5 border border-cat-blue/15 rounded-2xl text-sm">
        <Globe size={16} className="text-cat-blue shrink-0" />
        <span className="text-chocolate/70 font-medium">
          數據來源：<span className="font-bold text-chocolate">Google Analytics 4</span>
          <span className="text-chocolate/50 ml-2">（已過濾機器人流量）</span>
        </span>
        <div className="ml-auto flex items-center gap-3 shrink-0">
          {!loading && realtimeActiveUsers > 0 && (
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded-lg">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              {realtimeActiveUsers} 人在線
            </span>
          )}
          {updatedStr && (
            <span className="text-[11px] text-chocolate/40 hidden sm:block">更新於 {updatedStr}</span>
          )}
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="flex items-start gap-4 p-6 bg-red-50 border border-red-100 rounded-[2rem]">
          <AlertCircle size={20} className="text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-red-600 mb-1">無法載入 GA4 分析數據</div>
            <div className="text-sm text-red-500 break-words">{error}</div>
          </div>
          <button onClick={fetchReport} className="shrink-0 p-2 rounded-xl bg-red-100 text-red-400 hover:bg-red-200 transition-colors">
            <RefreshCw size={16} />
          </button>
        </div>
      )}

      {/* Stat Cards – show realtime numbers (last 30 min) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={<Eye className="text-cat-blue" />}
          label="過去 30 分鐘瀏覽"
          value={loading ? '—' : realtimeViews.toLocaleString()}
          badge="即時"
          sub={`累計 ${views.toLocaleString()} 次`}
        />
        <StatCard
          icon={<MousePointer2 className="text-pink-400" />}
          label="過去 30 分鐘點擊"
          value={loading ? '—' : realtimeClicks.toLocaleString()}
          badge="即時"
          sub={loading ? undefined : `CTR ${ctr}%`}
        />
        <StatCard
          icon={<Monitor className="text-chocolate/60" />}
          label="桌面端"
          value={loading ? '—' : `${desktopRate}%`}
        />
        <StatCard
          icon={<Smartphone className="text-chocolate/60" />}
          label="行動端"
          value={loading ? '—' : `${mobileRate}%`}
          sub={`回應 ${responseCount} 則`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white p-8 rounded-[2.5rem] border border-chocolate/5 soft-shadow">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-xl font-display font-bold text-chocolate">瀏覽趨勢</h3>
            <select
              value={String(rangeDays)}
              onChange={(e) => setRangeDays(e.target.value === '30' ? 30 : 7)}
              className="bg-cream/50 border-none rounded-xl px-4 py-2 text-sm font-bold text-chocolate outline-none"
            >
              <option value="7">過去 7 天</option>
              <option value="30">過去 30 天</option>
            </select>
          </div>

          {loading ? (
            <div className="h-[300px] flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-cat-blue border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="h-[300px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%" debounce={1}>
                <AreaChart data={trend}>
                  <defs>
                    <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#89CFF0" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#89CFF0" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F5F5DC" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#3D2B1F', opacity: 0.4, fontSize: 12 }} dy={10} />
                  <YAxis hide />
                  <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', background: '#fff' }} />
                  <Area type="monotone" dataKey="views" stroke="#89CFF0" strokeWidth={3} fillOpacity={1} fill="url(#colorViews)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-white p-8 rounded-[2.5rem] border border-chocolate/5 soft-shadow flex flex-col">
          <h3 className="text-xl font-display font-bold text-chocolate mb-8">流量來源</h3>
          <div className="flex-1 space-y-6">
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="space-y-2 animate-pulse">
                    <div className="flex justify-between">
                      <div className="h-4 w-20 bg-cream rounded" />
                      <div className="h-4 w-8 bg-cream rounded" />
                    </div>
                    <div className="h-2 w-full bg-cream rounded-full" />
                  </div>
                ))}
              </div>
            ) : (
              sources.map((source) => (
                <SourceProgress key={source.label} label={source.label} percentage={source.percentage} color={source.color} />
              ))
            )}
          </div>
          <div className="mt-8 p-4 bg-cream/50 rounded-2xl flex items-center gap-3">
            <Globe size={20} className="text-chocolate/40" />
            <span className="text-xs font-bold text-chocolate/60 uppercase tracking-wider">GA4 機器人過濾已啟用</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, change, sub, badge }: any) {
  return (
    <div className="bg-white p-6 rounded-[2.5rem] border border-chocolate/5 soft-shadow flex flex-col gap-2">
      <div className="flex items-center justify-between mb-2">
        <div className="p-2 bg-cream rounded-xl">{icon}</div>
        <div className="flex items-center gap-1.5">
          {badge && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-md">
              <span className="w-1 h-1 rounded-full bg-green-500 animate-pulse" />
              {badge}
            </span>
          )}
          {change && <span className="text-xs font-bold text-green-500 bg-green-50 px-2 py-1 rounded-lg">{change}</span>}
        </div>
      </div>
      <div className="text-chocolate/60 text-sm font-bold">{label}</div>
      <div className="text-3xl font-display font-bold text-chocolate">{value}</div>
      {sub && <div className="text-xs text-chocolate/40 font-medium">{sub}</div>}
    </div>
  );
}

function SourceProgress({ label, percentage, color }: any) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm font-bold text-chocolate">
        <span>{label}</span>
        <span className="opacity-40">{percentage}%</span>
      </div>
      <div className="h-2 w-full bg-cream rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-1000', color)} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}
