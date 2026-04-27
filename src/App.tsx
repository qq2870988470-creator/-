/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Plus, 
  History, 
  TrendingUp, 
  Calendar, 
  Hotel, 
  Coins, 
  Moon, 
  Trash2, 
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  BarChart3,
  Search,
  Download,
  Upload,
  Share2
} from 'lucide-react';
import { 
  format, 
  subDays, 
  isAfter, 
  differenceInDays, 
  parseISO, 
  startOfMonth, 
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  addDays,
  isWithinInterval
} from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  LineChart,
  Line
} from 'recharts';
import Fuse from 'fuse.js';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Helper for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Types
interface Entry {
  id: string;
  hotelName: string;
  date: string; // Check-in ISO string
  checkoutDate?: string; // Check-out ISO string
  points: number;
  actualPoints?: number;
  nights: number;
  cost: number;
  note?: string;
}

interface Account {
  id: string;
  name: string;
}

const generateId = () => {
  try {
    return crypto.randomUUID();
  } catch (e) {
    return Math.random().toString(36).substring(2, 11);
  }
};

const ACCOUNTS_STORAGE_KEY = 'huazhu_accounts_list';
const CURRENT_ACCOUNT_ID_KEY = 'huazhu_current_account_id';
const RECORDS_PREFIX = 'huazhu_records_';

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentAccountId, setCurrentAccountId] = useState<string>('');
  const [records, setRecords] = useState<Entry[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);

  const [isLoaded, setIsLoaded] = useState(false);
  const lastSavedRecordsRef = useRef<string>('');

  const [newAccountName, setNewAccountName] = useState('');
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [tempAccountName, setTempAccountName] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error' | 'success'>('idle');
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Calendar State
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // Form State
  const [formData, setFormData] = useState({
    hotelName: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    checkoutDate: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
    points: 0,
    actualPoints: 0,
    nights: 1,
    cost: 0,
    note: ''
  });

  // Sync to Server
  const syncWithServer = async (action: 'load' | 'save', dataToSave?: any) => {
    setSyncStatus('syncing');
    try {
      if (action === 'save' && dataToSave) {
        const res = await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dataToSave)
        });
        if (!res.ok) throw new Error('Server responded with error');
        setSyncStatus('success');
        setTimeout(() => setSyncStatus('idle'), 2000);
      } else {
        const res = await fetch('/api/data');
        if (!res.ok) throw new Error('Failed to load from server');
        const data = await res.json();
        setSyncStatus('success');
        setTimeout(() => setSyncStatus('idle'), 2000);
        return data;
      }
    } catch (error) {
      console.error('Sync failed:', error);
      setSyncStatus('error');
    }
    return null;
  };

  // Initial load: Accounts from server
  useEffect(() => {
    const loadFullData = async () => {
      const cloudData = await syncWithServer('load');
      const savedCurrentId = localStorage.getItem(CURRENT_ACCOUNT_ID_KEY);
      
      let loadedAccounts: Account[] = [];
      const savedAccounts = localStorage.getItem(ACCOUNTS_STORAGE_KEY);

      // Priority 1: Cloud data (if not empty)
      if (cloudData && Array.isArray(cloudData.accounts) && cloudData.accounts.length > 0) {
        loadedAccounts = cloudData.accounts;
        localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(loadedAccounts));
        if (cloudData.records) {
          for (const id in cloudData.records) {
            localStorage.setItem(`${RECORDS_PREFIX}${id}`, JSON.stringify(cloudData.records[id]));
          }
        }
      } 
      // Priority 2: Local data
      else if (savedAccounts) {
        try {
          const parsed = JSON.parse(savedAccounts);
          loadedAccounts = Array.isArray(parsed) ? parsed : [];
        } catch(e) {
          loadedAccounts = [];
        }
      }

      if (!Array.isArray(loadedAccounts) || loadedAccounts.length === 0) {
        const defaultAccount: Account = { id: generateId(), name: '默认账号' };
        loadedAccounts = [defaultAccount];
        setAccounts(loadedAccounts);
        setCurrentAccountId(defaultAccount.id);
      } else {
        setAccounts(loadedAccounts);
        const initialId = savedCurrentId && loadedAccounts.some(a => a.id === savedCurrentId) 
          ? savedCurrentId 
          : loadedAccounts[0].id;
        
        const storageKey = `${RECORDS_PREFIX}${initialId}`;
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            setRecords(parsed);
            lastSavedRecordsRef.current = saved;
          } catch(e) {
            setRecords([]);
          }
        }
        
        setCurrentAccountId(initialId);
      }
      setIsLoaded(true);
      
      // If server was empty but we have data locally/default, sync it to server for first time
      if (!cloudData || !cloudData.accounts || cloudData.accounts.length === 0) {
        setTimeout(() => {
          persistFullData(loadedAccounts);
        }, 1000);
      }
    };

    loadFullData();
  }, [isLoaded]);

  // Save full data whenever records or accounts change (Debounced / Event driven)
  const persistFullData = async (updatedAccounts?: Account[], specificRecords?: {id: string, data: Entry[]}) => {
    if (!isLoaded) return; // Prevent overwriting during initial load

    const currentAccs = updatedAccounts || accounts;
    const fullData: any = {
      accounts: currentAccs,
      records: {}
    };
    
    currentAccs.forEach(acc => {
      const saved = localStorage.getItem(`${RECORDS_PREFIX}${acc.id}`);
      if (saved) {
        try {
          fullData.records[acc.id] = JSON.parse(saved);
        } catch(e) {}
      }
    });

    if (specificRecords) {
      fullData.records[specificRecords.id] = specificRecords.data;
    }

    await syncWithServer('save', fullData);
  };

  // Auto-recovery for accounts list
  useEffect(() => {
    if (isAccountModalOpen && isLoaded && accounts.length === 0) {
      console.log('Detecting empty accounts list, recovering...');
      const defaultAccount: Account = { id: generateId(), name: '默认账号' };
      setAccounts([defaultAccount]);
      setCurrentAccountId(defaultAccount.id);
      persistFullData([defaultAccount]);
    }
  }, [isAccountModalOpen, isLoaded, accounts.length]);

  // Load records when currentAccountId changes
  useEffect(() => {
    if (!currentAccountId || !isLoaded) return;
    
    const storageKey = `${RECORDS_PREFIX}${currentAccountId}`;
    const savedRecords = localStorage.getItem(storageKey);
    let loaded: Entry[] = [];
    if (savedRecords) {
      try {
        loaded = JSON.parse(savedRecords);
      } catch (e) {
        loaded = [];
      }
    }
    
    setRecords(loaded);
    lastSavedRecordsRef.current = JSON.stringify(loaded); // Update ref to match new account's data
    localStorage.setItem(CURRENT_ACCOUNT_ID_KEY, currentAccountId);
  }, [currentAccountId]);

  // Save records for current account locally + trigger cloud sync
  useEffect(() => {
    if (!currentAccountId || !isLoaded) return;
    const storageKey = `${RECORDS_PREFIX}${currentAccountId}`;
    const newData = JSON.stringify(records);
    
    // Only save if data actually changed from what we last loaded/saved for this account
    if (lastSavedRecordsRef.current !== newData) {
      localStorage.setItem(storageKey, newData);
      lastSavedRecordsRef.current = newData;
      persistFullData(undefined, { id: currentAccountId, data: records });
    }
  }, [records, currentAccountId, isLoaded]);

  const addAccount = async () => {
    if (!newAccountName.trim()) return;
    const newAccount: Account = { 
      id: generateId(), 
      name: newAccountName.trim()
    };
    const updatedAccounts = [...accounts, newAccount];
    setAccounts(updatedAccounts);
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(updatedAccounts));
    setNewAccountName('');
    setIsAccountModalOpen(false);
    setCurrentAccountId(newAccount.id);
    await persistFullData(updatedAccounts);
  };

  const deleteAccount = async (id: string) => {
    if (accounts.length <= 1) {
      alert('至少保留一个账号');
      return;
    }
    if (confirm('确定要删除这个账号及其所有记录吗？此操作不可恢复。')) {
      const updatedAccounts = accounts.filter(a => a.id !== id);
      setAccounts(updatedAccounts);
      localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(updatedAccounts));
      localStorage.removeItem(`${RECORDS_PREFIX}${id}`);
      
      if (currentAccountId === id) {
        setCurrentAccountId(updatedAccounts[0].id);
      }
      await persistFullData(updatedAccounts);
    }
  };

  const renameAccount = async (id: string, newName: string) => {
    if (!newName.trim()) return;
    const updatedAccounts = accounts.map(a => a.id === id ? { ...a, name: newName.trim() } : a);
    setAccounts(updatedAccounts);
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(updatedAccounts));
    setEditingAccountId(null);
    await persistFullData(updatedAccounts);
  };

  const currentAccountName = accounts.find(a => a.id === currentAccountId)?.name || '未知账号';
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Export Data
  const exportData = () => {
    const allData: any = {
      accounts,
      records: {}
    };
    
    accounts.forEach(acc => {
      const saved = localStorage.getItem(`${RECORDS_PREFIX}${acc.id}`);
      if (saved) {
        allData.records[acc.id] = JSON.parse(saved);
      }
    });

    const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `华住会积分数据_${format(new Date(), 'yyyyMMdd_HHmm')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Import Data
  const importData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (!data.accounts || !data.records) throw new Error('无效的数据格式');

        if (confirm('导入将覆盖或合并现有账号，确认继续吗？')) {
          // Merge accounts
          const newAccounts = [...accounts];
          for (const impAcc of data.accounts) {
            if (!newAccounts.some(a => a.id === impAcc.id)) {
              newAccounts.push(impAcc);
            }
            // Save records for each imported account
            if (data.records[impAcc.id]) {
              localStorage.setItem(`${RECORDS_PREFIX}${impAcc.id}`, JSON.stringify(data.records[impAcc.id]));
            }
          }
          setAccounts(newAccounts);
          localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(newAccounts));
          alert('导入成功！已同步导入账号和记录。');
          window.location.reload(); // Refresh to ensure state is clean
        }
      } catch (err) {
        alert('导入失败：' + (err instanceof Error ? err.message : '未知错误'));
      }
    };
    reader.readAsText(file);
  };

  // Calculations
  const stats = useMemo(() => {
    const totalPoints = records.reduce((sum, r) => sum + (r.actualPoints || r.points), 0);
    const totalNights = records.reduce((sum, r) => sum + r.nights, 0);
    const totalCost = records.reduce((sum, r) => sum + r.cost, 0);
    // Estimated valuation: 100 points ≈ 1.3 CNY, rounded to 2 decimal places
    const estimatedValue = parseFloat((totalPoints * 0.013).toFixed(2));
    const memberDayProfit = parseFloat((estimatedValue - totalCost).toFixed(2));
    
    return {
      totalPoints,
      totalNights,
      totalCost,
      estimatedValue,
      memberDayProfit
    };
  }, [records]);

  const filteredRecords = useMemo(() => {
    if (!searchTerm.trim()) {
      return [...records].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    const fuse = new Fuse(records, {
      keys: ['hotelName'],
      threshold: 0.4, // Lower is stricter, 0.4 is a good balance for fuzzy search
      distance: 100,
    });

    const results = fuse.search(searchTerm);
    return results.map(result => result.item);
  }, [records, searchTerm]);

  // Chart data: Points vs Cost group by month (last 6 months)
  const chartData = useMemo(() => {
    const months: Record<string, { month: string; points: number; cost: number }> = {};
    const now = new Date();
    
    for (let i = 5; i >= 0; i--) {
      const d = subDays(now, i * 30);
      const m = format(d, 'yyyy-MM');
      months[m] = { month: m, points: 0, cost: 0 };
    }

    records.forEach(r => {
      const m = format(parseISO(r.date), 'yyyy-MM');
      if (months[m]) {
        months[m].points += r.points;
        months[m].cost += r.cost;
      }
    });

    return Object.values(months);
  }, [records]);

  // 30-day cooldown check
  const getCooldownStatus = (hotelName: string, targetDate: string = format(new Date(), 'yyyy-MM-dd')) => {
    const sameHotelRecords = records.filter(r => r.hotelName.trim() === hotelName.trim());
    if (sameHotelRecords.length === 0) return { canCheckIn: true, daysLeft: 0 };

    const lastCheckIn = sameHotelRecords.sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    )[0];

    const diff = differenceInDays(parseISO(targetDate), parseISO(lastCheckIn.date));
    const daysLeft = 30 - diff;

    return {
      canCheckIn: diff >= 30,
      daysLeft: daysLeft > 0 ? daysLeft : 0,
      lastDate: lastCheckIn.date
    };
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.hotelName) return;

    if (editingId) {
      setRecords(records.map(r => r.id === editingId ? { ...formData, id: editingId } : r));
    } else {
      const newEntry: Entry = { ...formData, id: generateId() };
      setRecords([newEntry, ...records]);
    }
    setIsFormOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setFormData({
      hotelName: '',
      date: format(new Date(), 'yyyy-MM-dd'),
      checkoutDate: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
      points: 0,
      actualPoints: 0,
      nights: 1,
      cost: 0,
      note: ''
    });
    setEditingId(null);
  };

  const handleEdit = (record: Entry) => {
    setFormData({
      hotelName: record.hotelName,
      date: record.date,
      checkoutDate: record.checkoutDate || format(addDays(parseISO(record.date), record.nights), 'yyyy-MM-dd'),
      points: record.points,
      actualPoints: record.actualPoints || 0,
      nights: record.nights,
      cost: record.cost,
      note: record.note || ''
    });
    setEditingId(record.id);
    setIsFormOpen(true);
  };

  const deleteRecord = (id: string) => {
    if (confirm('确定要删除这条记录吗？')) {
      setRecords(records.filter(r => r.id !== id));
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] pb-20 lg:pb-10 selection:bg-blue-100">
      {/* Background Mesh Overlay */}
      <div className="fixed inset-0 pointer-events-none z-0 opacity-[0.4]" 
           style={{ backgroundImage: `radial-gradient(#e2e8f0 1px, transparent 1px)`, backgroundSize: '24px 24px' }} />
      
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200/60 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4 relative z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 bg-slate-900 rounded-[12px] flex items-center justify-center text-white shadow-xl shadow-slate-200/50 ring-1 ring-white/20">
              <Hotel size={22} strokeWidth={2.5} />
            </div>
            <div className="hidden sm:block">
              <h1 className="font-extrabold text-[17px] tracking-tight text-slate-900 leading-none">华住积分大师</h1>
              <div className="flex items-center gap-1.5 mt-1">
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  syncStatus === 'syncing' ? "bg-amber-400 animate-pulse" :
                  syncStatus === 'success' ? "bg-emerald-500" :
                  syncStatus === 'error' ? "bg-rose-500" : "bg-slate-300"
                )} />
                <span 
                  className="text-[10px] text-slate-400 font-bold uppercase tracking-wider cursor-pointer hover:text-slate-600 transition-colors"
                  onClick={() => syncStatus === 'error' && persistFullData()}
                >
                  {syncStatus === 'syncing' ? '正在同步云端...' : 
                   syncStatus === 'error' ? '本地模式 (点击重试同步)' : 
                   '数据已安全同步至云端'}
                </span>
              </div>
            </div>
          </div>
          
          <div className="h-6 w-px bg-slate-200 mx-1 hidden sm:block" />
          
          {/* Account Switcher */}
          <button 
            onClick={() => setIsAccountModalOpen(true)}
            className="group flex items-center gap-2 px-3 py-1.5 bg-slate-50 hover:bg-white border border-slate-200/80 rounded-lg transition-all text-[13px] font-bold text-slate-700 shadow-sm hover:shadow-md"
          >
            <Search className="text-slate-400 group-hover:text-blue-500 transition-colors" size={13} />
            <span className="truncate max-w-[80px] sm:max-w-[140px]">{currentAccountName}</span>
            <ChevronRight size={13} className="text-slate-300 group-hover:text-slate-500 transition-transform rotate-90" />
          </button>
        </div>

          <div className="flex items-center gap-2 relative z-10">
            <div className="hidden md:flex items-center gap-1.5 mr-2">
              <button 
                onClick={exportData} 
                title="导出备份 (JSON)"
                className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all flex items-center gap-1"
              >
                <Download size={18} />
                <span className="text-[10px] font-bold">导出</span>
              </button>
              <button 
                onClick={() => fileInputRef.current?.click()} 
                title="导入备份"
                className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all flex items-center gap-1"
              >
                <Upload size={18} />
                <span className="text-[10px] font-bold">导入</span>
              </button>
            </div>
            <button 
              onClick={() => setIsFormOpen(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center gap-2.5 transition-all active:scale-[0.97] shadow-lg shadow-blue-200 text-sm font-bold border border-blue-400/20"
            >
              <Plus size={18} strokeWidth={3} />
              <span className="hidden sm:inline">新增行程</span>
            </button>
          </div>
      </header>

      <main className="max-w-[1700px] mx-auto px-6 py-10 gap-10 grid lg:grid-cols-12 auto-rows-min relative z-10">
        {/* Left Column: Schedule/Calendar */}
        <section className="lg:col-span-8 space-y-6 order-1">
          <div className="flex items-end justify-between px-2">
            <div>
              <h2 className="font-black text-2xl tracking-tight text-slate-900">行程日程</h2>
              <p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.2em] mt-1 ml-0.5">Stay Visualization</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-white/60 border border-slate-200 rounded-full shadow-sm">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Sync Active</span>
              </div>
              <div className="flex items-center gap-1 bg-white/80 backdrop-blur border border-slate-200 rounded-2xl p-1 shadow-sm">
                <button 
                  onClick={() => setCurrentMonth(subDays(currentMonth, 30))}
                  className="p-1.5 hover:bg-slate-50 rounded-lg transition-colors text-slate-400 hover:text-slate-900"
                >
                  <ChevronRight size={18} className="rotate-180" />
                </button>
                <div className="px-4 text-[13px] font-black text-slate-800 min-w-[110px] text-center tracking-tighter">
                  {format(currentMonth, 'yyyy / MM')}
                </div>
                <button 
                  onClick={() => setCurrentMonth(subDays(currentMonth, -30))}
                  className="p-1.5 hover:bg-slate-50 rounded-lg transition-colors text-slate-400 hover:text-slate-900"
                >
                  <Search size={18} />
                </button>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-[24px] overflow-hidden border border-slate-200/80 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <HotelCalendar records={records} currentMonth={currentMonth} />
          </div>
        </section>

        {/* Right Column: Data & Search */}
        <section className="lg:col-span-4 space-y-6 order-2">
          {/* Search Box - To the top of the right column */}
          <div className="relative group">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
            <input 
              type="text" 
              placeholder="搜索酒店名称关键词..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-4 py-3.5 bg-white border border-slate-200 rounded-[20px] text-sm font-bold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500 transition-all shadow-sm"
            />
          </div>

          {/* Stats Overview */}
          <div className="bg-white rounded-[32px] p-6 border border-slate-200 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-sm text-slate-900 uppercase tracking-wider">数据统计</h3>
              <TrendingUp size={16} className="text-blue-500" />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <StatCardSmall label="累计支出" value={`¥${stats.totalCost.toLocaleString()}`} color="blue" />
              <StatCardSmall label="累计积分" value={stats.totalPoints.toLocaleString()} color="orange" />
              <StatCardSmall label="积分利润" value={`¥${stats.memberDayProfit.toLocaleString()}`} color="emerald" />
              <StatCardSmall label="积分价值" value={`¥${stats.estimatedValue.toLocaleString()}`} color="rose" />
            </div>

            {/* Performance Chart */}
            <div className="h-[140px] w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <defs>
                    <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.8}/>
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.1}/>
                    </linearGradient>
                  </defs>
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '10px', fontWeight: 'bold' }}
                    cursor={{ fill: 'transparent' }}
                  />
                  <Bar dataKey="points" fill="url(#barGradient)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Order Details List */}
          <div className="bg-white rounded-[32px] p-8 border border-slate-200 shadow-[0_20px_50px_rgba(0,0,0,0.03)] space-y-6 flex flex-col min-h-[400px]">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <h3 className="font-black text-lg text-slate-900 tracking-tight">订单明细</h3>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Order History</span>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setIsFormOpen(true)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-900 p-2 rounded-xl transition-all active:scale-90"
                >
                  <Plus size={20} strokeWidth={3} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar">
              <div className="sticky top-0 bg-white/95 backdrop-blur py-2 z-10">
                <p className="text-[11px] font-black text-orange-500 flex items-center gap-1.5 uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                  Upcoming / In Progress ({records.filter(r => isAfter(parseISO(r.checkoutDate || r.date), new Date())).length})
                </p>
              </div>
              
              <AnimatePresence mode="popLayout">
                {filteredRecords.map((record) => (
                  <motion.div 
                    key={record.id} 
                    layout
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    onClick={() => handleEdit(record)}
                    className="group p-4 bg-slate-50 hover:bg-white border border-slate-100 hover:border-blue-200 rounded-[18px] transition-all relative cursor-pointer hover:shadow-xl hover:shadow-slate-200/40"
                  >
                    <div className="flex justify-between items-start">
                      <h4 className="font-bold text-[15px] text-slate-900 leading-tight group-hover:text-blue-600 transition-colors pr-8 truncate">
                        {record.hotelName}
                      </h4>
                      <div className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => deleteRecord(record.id)} className="p-1.5 text-slate-300 hover:text-rose-500 transition-colors bg-white rounded-lg shadow-sm">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-slate-200/60 pt-3">
                      <div className="text-[11px] text-slate-400 font-bold uppercase tracking-tight">
                        {format(parseISO(record.date), 'MMM dd')} — {record.checkoutDate ? format(parseISO(record.checkoutDate), 'MMM dd') : '--'}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-black text-slate-900 tabular-nums">¥{record.cost.toFixed(0)}</span>
                        <div className="h-6 w-px bg-slate-200" />
                        <div className="text-right">
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Points</div>
                          <div className={cn(
                            "text-[13px] font-black",
                            record.actualPoints ? "text-emerald-500" : "text-blue-500"
                          )}>
                            +{record.actualPoints || record.points}
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </section>
      </main>

      {/* Form Dialog */}
      <AnimatePresence>
        {isFormOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsFormOpen(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-3xl shadow-2xl z-50 overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-xl font-bold">{editingId ? '编辑行程记录' : '登记新入住'}</h2>
                <button 
                  onClick={() => { setIsFormOpen(false); resetForm(); }}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400"
                >
                  <Plus className="rotate-45" size={24} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-5">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                    <Hotel size={14} /> 酒店名称
                  </label>
                  <input 
                    type="text" 
                    required
                    list="hotel-history"
                    placeholder="例如：汉庭酒店上海南京路店"
                    value={formData.hotelName}
                    onChange={(e) => setFormData({...formData, hotelName: e.target.value})}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                  />
                  <datalist id="hotel-history">
                    {Array.from(new Set(records.map(r => r.hotelName))).map((h: string) => (
                      <option key={h} value={h} />
                    ))}
                  </datalist>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                      <Calendar size={14} /> 入住日期
                    </label>
                    <input 
                      type="date" 
                      required
                      value={formData.date}
                      onChange={(e) => {
                        const newDate = e.target.value;
                        setFormData({
                          ...formData, 
                          date: newDate,
                          checkoutDate: format(addDays(parseISO(newDate), formData.nights), 'yyyy-MM-dd')
                        });
                      }}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                      <Calendar size={14} /> 离店日期
                    </label>
                    <input 
                      type="date" 
                      required
                      value={formData.checkoutDate}
                      onChange={(e) => {
                        const newCheckout = e.target.value;
                        const nights = differenceInDays(parseISO(newCheckout), parseISO(formData.date));
                        setFormData({
                          ...formData, 
                          checkoutDate: newCheckout,
                          nights: nights > 0 ? nights : 1
                        });
                      }}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                      <Moon size={14} /> 登记间夜
                    </label>
                    <input 
                      type="number" 
                      min="1"
                      required
                      value={formData.nights}
                      onChange={(e) => {
                        const nights = parseInt(e.target.value) || 1;
                        setFormData({
                          ...formData, 
                          nights,
                          checkoutDate: format(addDays(parseISO(formData.date), nights), 'yyyy-MM-dd')
                        });
                      }}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                      <Coins size={14} /> 预计积分
                    </label>
                    <input 
                      type="number" 
                      required
                      placeholder="几百到几千"
                      value={formData.points || ''}
                      onChange={(e) => setFormData({...formData, points: parseInt(e.target.value) || 0})}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                      <CheckCircle2 size={14} /> 实际到账 (可选)
                    </label>
                    <input 
                      type="number" 
                      placeholder="到账后修改"
                      value={formData.actualPoints || ''}
                      onChange={(e) => setFormData({...formData, actualPoints: parseInt(e.target.value) || 0})}
                      className="w-full px-4 py-3 bg-white border border-blue-100 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all font-bold text-blue-600"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                    <TrendingUp size={14} /> 支出金额 (¥)
                  </label>
                  <input 
                    type="number" 
                    required
                    placeholder="0.00"
                    value={formData.cost || ''}
                    onChange={(e) => setFormData({...formData, cost: parseFloat(e.target.value) || 0})}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                  />
                </div>

                {/* Cooldown Warning in Form */}
                {formData.hotelName && (
                  <div className={cn(
                    "p-3 rounded-xl flex items-center gap-3 text-sm",
                    getCooldownStatus(formData.hotelName, formData.date).canCheckIn 
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                      : "bg-rose-50 text-rose-700 border border-rose-100"
                  )}>
                    {getCooldownStatus(formData.hotelName, formData.date).canCheckIn ? (
                      <>
                        <CheckCircle2 size={18} />
                        <p>该酒店当前处于可用状态，可放心登记。</p>
                      </>
                    ) : (
                      <>
                        <AlertCircle size={18} />
                        <p>注意：该酒店仍在冷却期，还需等待 <strong>{getCooldownStatus(formData.hotelName, formData.date).daysLeft}</strong> 天。</p>
                      </>
                    )}
                  </div>
                )}

                <button 
                  type="submit"
                  className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl shadow-lg shadow-blue-100 transition-all active:scale-[0.98]"
                >
                  {editingId ? '确认提交修改' : '确认保存记录'}
                </button>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Account Management Modal */}
      <AnimatePresence>
        {isAccountModalOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setIsAccountModalOpen(false); setEditingAccountId(null); }}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-white rounded-3xl shadow-2xl z-[60] overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-xl font-bold">账号管理</h2>
                <button 
                  onClick={() => { setIsAccountModalOpen(false); setEditingAccountId(null); }}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400"
                >
                  <Plus className="rotate-45" size={24} />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
                  {accounts.map(account => (
                    <div 
                      key={account.id}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer group",
                        account.id === currentAccountId 
                          ? "bg-blue-50 border-blue-200 ring-2 ring-blue-500/10" 
                          : "bg-white border-slate-100 hover:border-slate-300 shadow-sm"
                      )}
                      onClick={() => {
                        if (editingAccountId !== account.id) {
                          setCurrentAccountId(account.id);
                        }
                      }}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                          account.id === currentAccountId ? "bg-blue-600 text-white shadow-md shadow-blue-200" : "bg-slate-100 text-slate-500"
                        )}>
                          {account.name.charAt(0)}
                        </div>
                        {editingAccountId === account.id ? (
                          <input 
                            autoFocus
                            className="flex-1 bg-white border border-blue-400 rounded px-2 py-1 text-sm font-medium outline-none"
                            value={tempAccountName}
                            onChange={(e) => setTempAccountName(e.target.value)}
                            onBlur={() => renameAccount(account.id, tempAccountName)}
                            onKeyDown={(e) => e.key === 'Enter' && renameAccount(account.id, tempAccountName)}
                          />
                        ) : (
                          <span className="font-bold text-slate-700 truncate">{account.name}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        {editingAccountId !== account.id && (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingAccountId(account.id);
                              setTempAccountName(account.name);
                            }}
                            className="p-1.5 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          >
                            <TrendingUp size={14} className="rotate-90" />
                          </button>
                        )}
                        {accounts.length > 1 && editingAccountId !== account.id && (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteAccount(account.id);
                            }}
                            className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-4 border-t border-slate-100 space-y-4">
                  <div className="flex items-center gap-2">
                    <input 
                      type="text" 
                      placeholder="添加新子账号..."
                      className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-sm font-medium"
                      value={newAccountName}
                      onChange={(e) => setNewAccountName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addAccount()}
                    />
                    <button 
                      onClick={addAccount}
                      disabled={!newAccountName.trim()}
                      className="p-2.5 bg-slate-900 border border-slate-800 disabled:bg-slate-200 text-white rounded-xl transition-all shadow-xl shadow-slate-200"
                    >
                      <Plus size={20} strokeWidth={3} />
                    </button>
                  </div>
                  
                  <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100 flex items-start gap-3">
                    <AlertCircle size={16} className="text-blue-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-blue-700 font-medium leading-relaxed">
                      注意：数据默认保存在当前浏览器的本地缓存（LocalStorage）中。跨浏览器或下载代码运行需点击上方 <span className="font-bold underline">导出</span> 按钮备份数据，完成后在新处点击 <span className="font-bold underline">导入</span> 恢复。
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={importData} 
        accept=".json" 
        className="hidden" 
      />
    </div>
  );
}

function StatCardSmall({ label, value, color }: { label: string; value: string; color: 'blue' | 'orange' | 'emerald' | 'rose' }) {
  const textColors = {
    blue: 'text-blue-600',
    orange: 'text-orange-500',
    emerald: 'text-emerald-500',
    rose: 'text-rose-500'
  };

  return (
    <div className="bg-white/40 backdrop-blur-md border border-white/60 rounded-2xl p-4 shadow-sm transition-transform hover:-translate-y-1 duration-300">
      <p className="text-[9px] font-black uppercase text-slate-500 tracking-[0.1em] mb-1">{label}</p>
      <p className={cn("text-[19px] font-black tracking-tight tabular-nums", textColors[color])}>{value}</p>
    </div>
  );
}

function HotelCalendar({ records, currentMonth }: { records: Entry[], currentMonth: Date }) {
  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth)
  });

  const startDayOfWeek = startOfMonth(currentMonth).getDay();
  const paddingDays = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;

  const weekDays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

  const hotelColors = ['#0f172a', '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#7c3aed'];
  const hotelColorMap = useMemo(() => {
    const map = new Map<string, string>();
    Array.from(new Set(records.map(r => r.hotelName))).forEach((name, idx) => {
      map.set(name, hotelColors[idx % hotelColors.length]);
    });
    return map;
  }, [records]);

  return (
    <div className="w-full bg-[#fcfdfe]">
      <div className="grid grid-cols-7 border-b border-slate-100">
        {weekDays.map(day => (
          <div key={day} className="py-3 text-center text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{day}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: paddingDays }).map((_, i) => (
          <div key={`pad-${i}`} className="min-h-[100px] border-r border-b border-slate-50 bg-[#f8fafc]/40" />
        ))}
        {daysInMonth.map((day, idx) => {
          const dayRecords = records.filter(r => {
            const start = parseISO(r.date);
            const end = r.checkoutDate ? parseISO(r.checkoutDate) : addDays(start, r.nights);
            try {
              return isWithinInterval(day, { start, end: subDays(end, 1) });
            } catch (e) {
              return isSameDay(start, day);
            }
          });
          
          const isToday = isSameDay(day, new Date());

          return (
            <div key={day.toISOString()} 
                 className={cn(
                   "min-h-[100px] border-r border-b border-slate-100 p-2 relative transition-colors hover:bg-slate-50/50",
                   isToday && "bg-blue-50/20"
                 )}>
              <span className={cn(
                "text-[10px] font-black absolute top-2 right-2",
                isToday ? "text-blue-600" : "text-slate-300"
              )}>{format(day, 'd')}</span>
              
              <div className="mt-3 space-y-1">
                {dayRecords.map((r, rIdx) => (
                  <motion.div 
                    key={`${day.toISOString()}-${r.id}`}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    title={`${r.hotelName} (Stay Day)`}
                    className="h-6 rounded-md px-2 flex items-center overflow-hidden shadow-sm relative group bg-white border border-slate-200/60"
                  >
                    <div className="absolute inset-y-0 left-0 w-1 rounded-l-md" style={{ backgroundColor: hotelColorMap.get(r.hotelName) }} />
                    <span 
                      className="text-[9px] font-black truncate max-w-full pl-1"
                      style={{ color: hotelColorMap.get(r.hotelName) }}
                    >
                      {r.hotelName}
                    </span>
                  </motion.div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color, subLabel }: { 
  label: string; 
  value: string; 
  icon: React.ReactNode; 
  color: 'amber' | 'indigo' | 'rose' | 'emerald';
  subLabel?: string;
}) {
  const bgColors = {
    amber: 'bg-amber-50 text-amber-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    rose: 'bg-rose-50 text-rose-600',
    emerald: 'bg-emerald-50 text-emerald-600'
  };

  return (
    <motion.div 
      whileHover={{ y: -2 }}
      className="glass rounded-2xl p-4 flex flex-col gap-3 relative overflow-hidden group"
    >
      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", bgColors[color])}>
        {icon}
      </div>
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold tracking-tight mt-1">{value}</p>
        {subLabel && <p className="text-[10px] text-slate-400 mt-0.5">{subLabel}</p>}
      </div>
      {/* Subtle background decoration */}
      <div className="absolute -right-2 -bottom-2 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity">
        {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<any>, { size: 64 }) : null}
      </div>
    </motion.div>
  );
}
