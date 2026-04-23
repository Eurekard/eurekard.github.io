import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Eye, MousePointer2, Smartphone, Monitor, Globe } from 'lucide-react';
import { cn } from '../../lib/utils';

const data = [
  { name: '4/16', views: 40, clicks: 24 },
  { name: '4/17', views: 30, clicks: 13 },
  { name: '4/18', views: 20, clicks: 98 },
  { name: '4/19', views: 27, clicks: 39 },
  { name: '4/20', views: 18, clicks: 48 },
  { name: '4/21', views: 23, clicks: 38 },
  { name: '4/22', views: 34, clicks: 43 },
];

export default function AnalyticsView({ cardId }: { cardId: string }) {
  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard icon={<Eye className="text-cat-blue" />} label="總瀏覽量" value="1,284" change="+12%" />
        <StatCard icon={<MousePointer2 className="text-pink-400" />} label="總點擊數" value="342" change="+5%" />
        <StatCard icon={<Monitor className="text-chocolate/60" />} label="桌面端" value="45%" sub="578 views" />
        <StatCard icon={<Smartphone className="text-chocolate/60" />} label="行動端" value="55%" sub="706 views" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white p-8 rounded-[2.5rem] border border-chocolate/5 soft-shadow">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-xl font-display font-bold text-chocolate">瀏覽趨勢</h3>
            <select className="bg-cream/50 border-none rounded-xl px-4 py-2 text-sm font-bold text-chocolate outline-none">
              <option>過去 7 天</option>
              <option>過去 30 天</option>
            </select>
          </div>
          <div className="h-[300px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%" debounce={1}>
              <AreaChart data={data}>
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
            <SourceProgress label="Instagram" percentage={55} color="bg-pink-400" />
            <SourceProgress label="Twitter / X" percentage={25} color="bg-chocolate" />
            <SourceProgress label="Facebook" percentage={12} color="bg-blue-600" />
            <SourceProgress label="直接流量" percentage={8} color="bg-cat-blue" />
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
          className={cn("h-full rounded-full transition-all duration-1000", color)} 
          style={{ width: `${percentage}%` }} 
        />
      </div>
    </div>
  );
}
