import React, { useEffect, useMemo, useState } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Eye, MousePointer2, Smartphone, Monitor, Globe } from 'lucide-react';
import { cn } from '../../lib/utils';
import { db } from '../../lib/firebase';
import { onSnapshot, collection } from 'firebase/firestore';
import { AnalyticsDevice, AnalyticsSource, buildRecentDays, formatShortDate } from '../../lib/analytics';

type AnalyticsEvent = {
  type: 'view' | 'click';
  day: string;
  device: AnalyticsDevice;
  source: AnalyticsSource;
};

const SOURCE_COLOR_MAP: Record<AnalyticsSource, string> = {
  direct: 'bg-cat-blue',
  social: 'bg-pink-400',
  search: 'bg-chocolate',
  referral: 'bg-blue-600',
  unknown: 'bg-gray-400',
};

const SOURCE_LABEL_MAP: Record<AnalyticsSource, string> = {
  direct: '直接流量',
  social: '社群來源',
  search: '搜尋引擎',
  referral: '引薦網站',
  unknown: '其他',
};

export default function AnalyticsView({ cardId, username }: { cardId: string; username?: string }) {
  const [views, setViews] = useState(0);
  const [clicks, setClicks] = useState(0);
  const [desktopRate, setDesktopRate] = useState(0);
  const [mobileRate, setMobileRate] = useState(0);
  const [trend, setTrend] = useState<{ name: string; views: number; clicks: number }[]>([]);
  const [sources, setSources] = useState<{ label: string; percentage: number; color: string }[]>([
    { label: '直接流量', percentage: 0, color: 'bg-cat-blue' },
  ]);
  const [responseCount, setResponseCount] = useState(0);
  const [rangeDays, setRangeDays] = useState<7 | 30>(7);

  useEffect(() => {
    if (!cardId || cardId === 'demo_user') {
      setTrend(buildRecentDays(rangeDays).map((day) => ({ name: formatShortDate(day), views: 0, clicks: 0 })));
      return;
    }

    const unsubAnalytics = onSnapshot(collection(db, 'analytics', cardId, 'events'), (snapshot) => {
      const events = snapshot.docs.map((row) => row.data() as AnalyticsEvent);

      const totalViews = events.filter((event) => event.type === 'view').length;
      const totalClicks = events.filter((event) => event.type === 'click').length;

      const desktopViews = events.filter((event) => event.type === 'view' && event.device === 'desktop').length;
      const mobileViews = events.filter((event) => event.type === 'view' && event.device === 'mobile').length;

      setViews(totalViews);
      setClicks(totalClicks);
      setDesktopRate(totalViews > 0 ? Math.round((desktopViews / totalViews) * 100) : 0);
      setMobileRate(totalViews > 0 ? Math.round((mobileViews / totalViews) * 100) : 0);

      const days = buildRecentDays(rangeDays);
      const dayCounts = new Map<string, { views: number; clicks: number }>();
      days.forEach((day) => dayCounts.set(day, { views: 0, clicks: 0 }));

      events.forEach((event) => {
        const bucket = dayCounts.get(event.day);
        if (!bucket) return;
        if (event.type === 'view') bucket.views += 1;
        if (event.type === 'click') bucket.clicks += 1;
      });

      setTrend(days.map((day) => ({ name: formatShortDate(day), ...(dayCounts.get(day) || { views: 0, clicks: 0 }) })));

      const sourceViews: Record<AnalyticsSource, number> = {
        direct: 0, social: 0, search: 0, referral: 0, unknown: 0,
      };

      events.forEach((event) => {
        if (event.type !== 'view') return;
        sourceViews[event.source] += 1;
      });

      const sourceRows = (Object.keys(sourceViews) as AnalyticsSource[])
        .map((source) => ({ source, count: sourceViews[source] }))
        .filter((row) => row.count > 0)
        .sort((a, b) => b.count - a.count)
        .map((row) => ({
          label: SOURCE_LABEL_MAP[row.source],
          percentage: totalViews > 0 ? Math.round((row.count / totalViews) * 100) : 0,
          color: SOURCE_COLOR_MAP[row.source],
        }));

      setSources(sourceRows.length > 0 ? sourceRows : [{ label: '直接流量', percentage: 0, color: 'bg-cat-blue' }]);
    });

    const unsubResponses = onSnapshot(collection(db, 'cards', cardId, 'responses'), (snapshot) => {
      setResponseCount(snapshot.size);
    });

    return () => {
      unsubAnalytics();
      unsubResponses();
    };
  }, [cardId, rangeDays]);

  const ctr = useMemo(() => {
    if (!views) return 0;
    return Number(((clicks / views) * 100).toFixed(1));
  }, [clicks, views]);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      {/* Bot Filter Status Banner */}
      <div className="flex items-center gap-3 px-5 py-3 bg-cat-blue/5 border border-cat-blue/15 rounded-2xl text-sm">
        <Globe size={16} className="text-cat-blue shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-chocolate/70 font-medium">機器人過濾已啟用 </span>
          <span className="text-chocolate font-bold">（UA 偵測 + GA4 雙重過濾）</span>
        </div>
        <span className="text-[11px] text-chocolate/40 hidden sm:block shrink-0">即時數據</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard icon={<Eye className="text-cat-blue" />} label="總瀏覽量" value={views.toLocaleString()} />
        <StatCard icon={<MousePointer2 className="text-pink-400" />} label="總點擊數" value={clicks.toLocaleString()} sub={`CTR ${ctr}%`} />
        <StatCard icon={<Monitor className="text-chocolate/60" />} label="桌面端" value={`${desktopRate}%`} />
        <StatCard icon={<Smartphone className="text-chocolate/60" />} label="行動端" value={`${mobileRate}%`} sub={`回應 ${responseCount} 則`} />
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
          <div className="h-[300px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" debounce={1}>
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#89CFF0" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#89CFF0" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F5F5DC" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#3D2B1F', opacity: 0.4, fontSize: 12 }} dy={10} />
                <YAxis hide />
                <Tooltip
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', background: '#fff' }}
                />
                <Area type="monotone" dataKey="views" stroke="#89CFF0" strokeWidth={3} fillOpacity={1} fill="url(#colorViews)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-8 rounded-[2.5rem] border border-chocolate/5 soft-shadow flex flex-col">
          <h3 className="text-xl font-display font-bold text-chocolate mb-8">流量來源</h3>
          <div className="flex-1 space-y-6">
            {sources.map((source) => (
              <SourceProgress key={source.label} label={source.label} percentage={source.percentage} color={source.color} />
            ))}
          </div>
          <div className="mt-8 p-4 bg-cream/50 rounded-2xl flex items-center gap-3">
            <Globe size={20} className="text-chocolate/40" />
            <span className="text-xs font-bold text-chocolate/60 uppercase tracking-wider">數據每 5 分鐘更新一次</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, change, sub }: any) {
  return (
    <div className="bg-white p-6 rounded-[2.5rem] border border-chocolate/5 soft-shadow flex flex-col gap-2">
      <div className="flex items-center justify-between mb-2">
        <div className="p-2 bg-cream rounded-xl">{icon}</div>
        {change && (
          <span className="text-xs font-bold text-green-500 bg-green-50 px-2 py-1 rounded-lg">{change}</span>
        )}
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
        <div
          className={cn('h-full rounded-full transition-all duration-1000', color)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
