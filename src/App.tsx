import React, { useState, useEffect, useCallback } from 'react';
import { ArrowUpRight, ArrowDownRight, PlusCircle, LayoutDashboard, History, Filter, Download, Briefcase, Bell, Calendar, RefreshCw, Trash2, CheckCircle, Clock } from 'lucide-react';
import { supabase } from './supabaseClient';

interface Project {
  id: string;
  name: string;
}

interface PlannedMovement {
  id: string;
  type: 'subscription' | 'debt_taken' | 'debt_given';
  title: string;
  amount: number;
  due_date: string;
  is_recurring: boolean;
  status: 'pending' | 'paid' | 'cancelled';
  reminder_days_before: number;
}

interface Transaction {
  id: string;
  type: 'inflow' | 'outflow';
  amount: number;
  date: string;
  tier1_category: string;
  tier2_memo: string;
  behavioral_source?: string;
  project_id?: string;
  projects?: { name: string };
}

const ActivityRing: React.FC<{ 
  percentage: number; 
  color: string; 
  label: string; 
  subtext?: string;
  size?: number;
}> = ({ percentage, color, label, subtext, size = 80 }) => {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (Math.min(percentage, 100) / 100) * circumference;

  return (
    <div className="ring-item">
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="currentColor"
            strokeWidth="6"
            className="ring-circle-bg"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke={color}
            strokeWidth="6"
            strokeDasharray={circumference}
            style={{ 
              strokeDashoffset,
              transition: 'stroke-dashoffset 1s ease-out'
            }}
            className="ring-circle-fill"
          />
        </svg>
        <div style={{ 
          position: 'absolute', 
          top: '50%', 
          left: '50%', 
          transform: 'translate(-50%, -50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}>
          <span className="ring-percent">{Math.round(percentage)}%</span>
        </div>
      </div>
      <div className="ring-label">
        <div>{label}</div>
        {subtext && <div style={{ fontSize: '0.6rem', opacity: 0.6 }}>{subtext}</div>}
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'input' | 'dashboard' | 'recurring'>('input');
  const [type, setType] = useState<'inflow' | 'outflow'>('outflow');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [memo, setMemo] = useState('');
  const [source, setSource] = useState('regular');
  const [excludeTravel, setExcludeTravel] = useState(false);
  const [transactionDate, setTransactionDate] = useState(() => new Date().toISOString().split('T')[0]);

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [dateRange, setDateRange] = useState<'thisMonth' | 'lastMonth' | 'all'>('thisMonth');
  const [budget, setBudget] = useState<number>(() => Number(localStorage.getItem('fin_budget')) || 50000);

  const [summary, setSummary] = useState({ gross_revenue: 0, gross_expenses: 0, net_profit: 0 });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [plannedItems, setPlannedItems] = useState<PlannedMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission === 'granted';
    }
    return false;
  });

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) {
      alert('This browser does not support notifications.');
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      setPushEnabled(true);
      new Notification("FinControl", { 
        body: "Notifications are now active!",
        icon: "/favicon.svg"
      });
    } else {
      alert('Notification permission denied.');
    }
  };

  useEffect(() => {
    localStorage.setItem('fin_budget', budget.toString());
  }, [budget]);

  const fetchProjects = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('status', 'active');
      if (error) throw error;
      setProjects(data || []);
    } catch (err) {
      console.error('Error fetching projects:', err);
    }
  }, []);

  const getDateBounds = useCallback(() => {
    const now = new Date();
    if (dateRange === 'thisMonth') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      return { start };
    }
    if (dateRange === 'lastMonth') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();
      return { start, end };
    }
    return {};
  }, [dateRange]);

  const checkUpcomingReminders = useCallback((items: PlannedMovement[]) => {
    if (Notification.permission !== 'granted') return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    items.forEach(item => {
      if (item.status !== 'pending') return;

      const dueDate = new Date(item.due_date);
      dueDate.setHours(0, 0, 0, 0);

      const diffTime = dueDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays >= 0 && diffDays <= item.reminder_days_before) {
        const key = `notified_${item.id}_${today.toISOString().split('T')[0]}`;
        if (!localStorage.getItem(key)) {
          const typeLabel = item.type === 'subscription' ? 'Subscription' : item.type === 'debt_taken' ? 'Return' : 'Collect';
          new Notification(`FinControl: ${typeLabel} Due`, {
            body: `${item.title} (₹${item.amount.toLocaleString()}) is due in ${diffDays === 0 ? 'today' : diffDays + ' day(s)'}!`,
            icon: "/favicon.svg"
          });
          localStorage.setItem(key, 'true');
        }
      }
    });
  }, []);

  const downloadCSV = useCallback(() => {
    const headers = ['Date', 'Type', 'Amount', 'Category', 'Project', 'Memo'];
    const rows = transactions.map(t => [
      new Date(t.date).toLocaleDateString(),
      t.type,
      t.amount,
      t.tier1_category,
      t.projects?.name || '',
      `"${t.tier2_memo.replace(/"/g, '""')}"`
    ]);
    
    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `fincontrol_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [transactions]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { start, end } = getDateBounds();
      
      // 1. Fetch Transactions
      let query = supabase
        .from('transactions')
        .select('*, projects(name)')
        .order('date', { ascending: false });

      if (excludeTravel) query = query.neq('tier1_category', 'Travel');
      if (start) query = query.gte('date', start);
      if (end) query = query.lte('date', end);

      const { data: transData, error: transError } = await query;
      if (transError) throw transError;
      setTransactions((transData as Transaction[]) || []);

      // 2. Fetch Planned Items
      const { data: plannedData, error: plannedError } = await supabase
        .from('planned_movements')
        .select('*')
        .order('due_date', { ascending: true });
      
      if (plannedError) throw plannedError;
      setPlannedItems(plannedData || []);

      // 3. Check for Notifications
      checkUpcomingReminders(plannedData || []);

      // 4. Calculate Summary for the filtered range
      const gross_revenue = (transData as Transaction[])
        ?.filter(t => t.type === 'inflow')
        .reduce((sum, t) => sum + Number(t.amount), 0) || 0;
      
      const gross_expenses = (transData as Transaction[])
        ?.filter(t => t.type === 'outflow')
        .reduce((sum, t) => sum + Number(t.amount), 0) || 0;

      setSummary({
        gross_revenue,
        gross_expenses,
        net_profit: gross_revenue - gross_expenses
      });

    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  }, [excludeTravel, getDateBounds, checkUpcomingReminders]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (activeTab === 'dashboard' || activeTab === 'recurring') {
      fetchData();
    }
  }, [activeTab, fetchData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Strict Validation (Replaces Backend Logic)
    if (type === 'inflow' && !source) {
      alert('Inflow requires a behavioral source');
      return;
    }

    const payload = {
      type,
      amount: parseFloat(amount),
      tier1_category: category,
      tier2_memo: memo,
      behavioral_source: type === 'inflow' ? source : null,
      project_id: selectedProjectId || null,
      date: new Date(transactionDate).toISOString()
    };

    try {
      const { error } = await supabase.from('transactions').insert([payload]);
      if (error) throw error;
      
      alert('Transaction saved to Ledger!');
      setAmount('');
      setCategory('');
      setMemo('');
      setSelectedProjectId('');
    } catch (err) {
      const error = err as { message: string };
      alert(`Error: ${error.message}`);
    }
  };

  const categoryBreakdown = transactions
    .filter(t => t.type === 'outflow')
    .reduce((acc: Record<string, number>, t) => {
      acc[t.tier1_category] = (acc[t.tier1_category] || 0) + Number(t.amount);
      return acc;
    }, {});

  const maxExpense = Math.max(...(Object.values(categoryBreakdown) as number[]), 1);
  
  const budgetUsed = (summary.gross_expenses / (budget || 1)) * 100;
  const spendRatio = (summary.gross_expenses / (summary.gross_revenue || 1)) * 100;
  const savingsRate = (Math.max(0, summary.net_profit) / (summary.gross_revenue || 1)) * 100;

  const topCategories = Object.entries(categoryBreakdown)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 3);

  const [pType, setPType] = useState<'subscription' | 'debt_taken' | 'debt_given'>('subscription');
  const [pTitle, setPTitle] = useState('');
  const [pAmount, setPAmount] = useState('');
  const [pDate, setPDate] = useState('');
  const [pRecurring, setPRecurring] = useState(false);
  const [pDaysBefore, setPDaysBefore] = useState('1');

  const handlePlannedSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      type: pType,
      title: pTitle,
      amount: parseFloat(pAmount),
      due_date: pDate,
      is_recurring: pRecurring,
      reminder_days_before: parseInt(pDaysBefore),
      status: 'pending'
    };

    try {
      const { error } = await supabase.from('planned_movements').insert([payload]);
      if (error) throw error;
      alert('Planned movement saved!');
      setPTitle('');
      setPAmount('');
      setPDate('');
      fetchData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const markAsPaid = async (item: PlannedMovement) => {
    try {
      // 1. Mark as paid
      const { error: updateError } = await supabase
        .from('planned_movements')
        .update({ status: 'paid' })
        .eq('id', item.id);
      
      if (updateError) throw updateError;

      // 2. Log actual transaction
      const payload = {
        type: item.type === 'debt_given' ? 'inflow' : 'outflow',
        amount: item.amount,
        tier1_category: item.type === 'subscription' ? 'Bills' : 'Debt',
        tier2_memo: `Settled: ${item.title}`,
        date: new Date().toISOString()
      };
      await supabase.from('transactions').insert([payload]);

      // 3. If recurring, create next month's entry
      if (item.is_recurring) {
        const nextDate = new Date(item.due_date);
        nextDate.setMonth(nextDate.getMonth() + 1);
        await supabase.from('planned_movements').insert([{
          ...item,
          id: undefined,
          due_date: nextDate.toISOString().split('T')[0],
          status: 'pending',
          created_at: undefined
        }]);
      }

      fetchData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const deletePlanned = async (id: string) => {
    if (!confirm('Delete this plan?')) return;
    try {
      const { error } = await supabase.from('planned_movements').delete().eq('id', id);
      if (error) throw error;
      fetchData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  return (
    <div className="container">
      <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ color: 'var(--accent-blue)', margin: 0, fontSize: '1.75rem' }}>FinControl</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 500 }}>PROFESSIONAL LEDGER</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.05)', padding: '0.4rem', borderRadius: '14px', border: '1px solid var(--border)' }}>
          {!pushEnabled && (
            <button 
              onClick={requestNotificationPermission}
              className="toggle-btn"
              style={{ padding: '0.5rem 0.75rem' }}
              title="Enable Notifications"
            >
              <Bell size={18} />
            </button>
          )}
          <button 
            onClick={() => setActiveTab('input')}
            className={`toggle-btn ${activeTab === 'input' ? 'active' : ''}`}
            style={{ padding: '0.5rem 1rem' }}
          >
            <PlusCircle size={18} />
          </button>
          <button 
            onClick={() => setActiveTab('recurring')}
            className={`toggle-btn ${activeTab === 'recurring' ? 'active' : ''}`}
            style={{ padding: '0.5rem 1rem' }}
          >
            <Calendar size={18} />
          </button>
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`toggle-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            style={{ padding: '0.5rem 1rem' }}
          >
            <LayoutDashboard size={18} />
          </button>
        </div>
      </header>

      {activeTab === 'input' ? (
        <div className="card">
          <h2 style={{ marginBottom: '1.5rem' }}>Record Movement</h2>
          
          <div className="toggle-container">
            <button 
              className={`toggle-btn ${type === 'inflow' ? 'active inflow' : ''}`}
              onClick={() => setType('inflow')}
            >
              <ArrowUpRight size={20} /> Earned
            </button>
            <button 
              className={`toggle-btn ${type === 'outflow' ? 'active outflow' : ''}`}
              onClick={() => setType('outflow')}
            >
              <ArrowDownRight size={20} /> Spent
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="input-grid" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div className="input-group">
                  <label>Amount (₹)</label>
                  <input 
                    type="number" 
                    value={amount} 
                    onChange={(e) => setAmount(e.target.value)} 
                    placeholder="0.00" 
                    inputMode="decimal"
                    required 
                  />
                </div>
                <div className="input-group">
                  <label>Date</label>
                  <input 
                    type="date" 
                    value={transactionDate} 
                    onChange={(e) => setTransactionDate(e.target.value)} 
                    required 
                  />
                </div>
              </div>
              <div className="input-group">
                <label>{type === 'inflow' ? 'Source' : 'Category'}</label>
                {type === 'inflow' ? (
                  <select value={category} onChange={(e) => setCategory(e.target.value)} required>
                    <option value="">Select Source</option>
                    <option value="Salary">Salary</option>
                    <option value="Freelance">Freelance</option>
                    <option value="Family">Family</option>
                    <option value="Passive">Investment/Passive</option>
                    <option value="Gift">Gift/Other</option>
                  </select>
                ) : (
                  <select value={category} onChange={(e) => setCategory(e.target.value)} required>
                    <option value="">Select Category</option>
                    <option value="Food">Food & Dining</option>
                    <option value="Travel">Travel</option>
                    <option value="Bills">Fixed Bills</option>
                    <option value="Shopping">Shopping</option>
                    <option value="Health">Health</option>
                    <option value="Investment">Investment</option>
                  </select>
                )}
              </div>
              <div className="input-group">
                <label>Project (Optional)</label>
                <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
                  <option value="">No Project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {type === 'inflow' && (
              <div className="input-group">
                <label>Behavioral Nature</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {['regular', 'active', 'passive'].map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`toggle-btn ${source === s ? 'active' : ''}`}
                      style={{ padding: '0.5rem', fontSize: '0.8rem' }}
                      onClick={() => setSource(s)}
                    >
                      {s.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="input-group">
              <label>Memo (Tier 2 Granularity)</label>
              <textarea 
                value={memo} 
                onChange={(e) => setMemo(e.target.value)} 
                placeholder={type === 'inflow' ? "e.g. Project X final payout" : "e.g. Dinner with team at Lucknow"}
                rows={3}
                required
              />
            </div>

            <button type="submit" className="btn-primary">Save to Ledger</button>
          </form>
        </div>
      ) : activeTab === 'recurring' ? (
        <div>
          <div className="card">
            <h2 style={{ marginBottom: '1.5rem' }}>Plan Movement</h2>
            <form onSubmit={handlePlannedSubmit}>
              <div className="toggle-container" style={{ marginBottom: '1rem' }}>
                <button type="button" className={`toggle-btn ${pType === 'subscription' ? 'active' : ''}`} onClick={() => setPType('subscription')}>Subscription</button>
                <button type="button" className={`toggle-btn ${pType === 'debt_taken' ? 'active' : ''}`} onClick={() => setPType('debt_taken')}>Borrowed</button>
                <button type="button" className={`toggle-btn ${pType === 'debt_given' ? 'active' : ''}`} onClick={() => setPType('debt_given')}>Lent</button>
              </div>

              <div className="input-grid" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div className="input-group">
                  <label>Title</label>
                  <input type="text" value={pTitle} onChange={(e) => setPTitle(e.target.value)} placeholder="e.g. Netflix, Rahul's Loan" required />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <div className="input-group">
                    <label>Amount</label>
                    <input type="number" value={pAmount} onChange={(e) => setPAmount(e.target.value)} placeholder="0.00" required />
                  </div>
                  <div className="input-group">
                    <label>Due Date</label>
                    <input type="date" value={pDate} onChange={(e) => setPDate(e.target.value)} required />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <div className="input-group">
                    <label>Remind Days Before</label>
                    <select value={pDaysBefore} onChange={(e) => setPDaysBefore(e.target.value)}>
                      <option value="0">On Due Date</option>
                      <option value="1">1 Day Before</option>
                      <option value="3">3 Days Before</option>
                      <option value="7">1 Week Before</option>
                    </select>
                  </div>
                  {pType === 'subscription' && (
                    <div className="input-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingTop: '1.5rem' }}>
                      <input type="checkbox" checked={pRecurring} onChange={(e) => setPRecurring(e.target.checked)} style={{ width: 'auto' }} />
                      <label style={{ margin: 0 }}>Auto-Renew Monthly</label>
                    </div>
                  )}
                </div>
              </div>
              <button type="submit" className="btn-primary">Add to Schedule</button>
            </form>
          </div>

          <div className="card">
            <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={20} /> Schedule
            </h2>
            <div className="transaction-list">
              {plannedItems.filter(i => i.status === 'pending').map(item => (
                <div key={item.id} className="transaction-item">
                  <div className="transaction-info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <h4 style={{ margin: 0 }}>{item.title}</h4>
                      {item.is_recurring && <RefreshCw size={12} className="text-secondary" />}
                    </div>
                    <small style={{ color: 'var(--text-secondary)' }}>
                      Due: {new Date(item.due_date).toLocaleDateString()} • {item.type.replace('_', ' ')}
                    </small>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div className="transaction-amount">₹{item.amount.toLocaleString()}</div>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button onClick={() => markAsPaid(item)} style={{ background: 'none', border: 'none', color: 'var(--accent-inflow)', cursor: 'pointer' }} title="Mark Settle">
                        <CheckCircle size={20} />
                      </button>
                      <button onClick={() => deletePlanned(item.id)} style={{ background: 'none', border: 'none', color: 'var(--accent-outflow)', cursor: 'pointer' }} title="Delete">
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {plannedItems.filter(i => i.status === 'pending').length === 0 && (
                <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem' }}>No upcoming plans.</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div className="filter-scroll-container" style={{ margin: 0 }}>
              {(['thisMonth', 'lastMonth', 'all'] as const).map(range => (
                <button
                  key={range}
                  className={`toggle-btn ${dateRange === range ? 'active' : ''}`}
                  onClick={() => setDateRange(range)}
                >
                  {range === 'thisMonth' ? 'This Month' : range === 'lastMonth' ? 'Last Month' : 'All Time'}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{ margin: 0, fontSize: '0.6rem' }}>Budget</label>
              <input 
                type="number" 
                value={budget} 
                onChange={(e) => setBudget(Number(e.target.value))}
                style={{ width: '80px', padding: '0.4rem', fontSize: '0.8rem' }}
              />
            </div>
          </div>

          <div className="rings-container">
            <ActivityRing 
              percentage={budgetUsed} 
              color="var(--accent-outflow)" 
              label="Budget Used" 
              subtext={`₹${summary.gross_expenses.toLocaleString()} / ₹${budget.toLocaleString()}`}
            />
            <ActivityRing 
              percentage={spendRatio} 
              color="var(--accent-blue)" 
              label="Spend Ratio" 
              subtext="Outflow / Inflow"
            />
            <ActivityRing 
              percentage={savingsRate} 
              color="var(--accent-inflow)" 
              label="Savings Rate" 
              subtext="Net / Inflow"
            />
          </div>

          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-label">Inflow</div>
              <div className="metric-value positive">₹{summary.gross_revenue.toLocaleString()}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Outflow</div>
              <div className="metric-value negative">₹{summary.gross_expenses.toLocaleString()}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Net</span>
                <span style={{ fontSize: '0.6rem', opacity: 0.6 }}>{(summary.net_profit / (summary.gross_revenue || 1) * 100).toFixed(1)}%</span>
              </div>
              <div className="metric-value" style={{ color: summary.net_profit >= 0 ? 'var(--accent-inflow)' : 'var(--accent-outflow)' }}>
                ₹{summary.net_profit.toLocaleString()}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
            <div className="card" style={{ margin: 0 }}>
              <h3 style={{ marginBottom: '1.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                Expense Breakdown
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {Object.entries(categoryBreakdown).length > 0 ? (
                  Object.entries(categoryBreakdown)
                    .sort(([, a], [, b]) => (b as number) - (a as number))
                    .map(([cat, val]) => (
                      <div key={cat} className="breakdown-item">
                        <div className="breakdown-header">
                          <span>{cat}</span>
                          <span>₹{(val as number).toLocaleString()}</span>
                        </div>
                        <div className="progress-container">
                          <div 
                            className="progress-bar"
                            style={{ width: `${((val as number) / maxExpense) * 100}%` }} 
                          />
                        </div>
                      </div>
                    ))
                ) : (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>No records.</p>
                )}
              </div>
            </div>

            <div className="card" style={{ margin: 0 }}>
              <h3 style={{ marginBottom: '1.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Top Categories</h3>
              <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', height: '100%', paddingBottom: '1rem' }}>
                {topCategories.length > 0 ? topCategories.map(([cat, val]) => (
                  <ActivityRing 
                    key={cat}
                    percentage={((val as number) / summary.gross_expenses) * 100}
                    color="var(--accent-blue)"
                    label={cat}
                    size={65}
                  />
                )) : (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Insufficient data.</p>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, fontSize: '1.1rem' }}>
                <History size={20} /> Recent Logs
              </h2>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button 
                  className="toggle-btn"
                  style={{ width: 'auto', padding: '0.5rem 0.75rem' }}
                  onClick={downloadCSV}
                  title="Export to CSV"
                >
                  <Download size={14} />
                </button>
                <button 
                  className={`toggle-btn ${excludeTravel ? 'active' : ''}`}
                  style={{ width: 'auto', padding: '0.5rem 0.75rem' }}
                  onClick={() => setExcludeTravel(!excludeTravel)}
                >
                  <Filter size={14} /> {excludeTravel ? 'Regular' : 'Silo'}
                </button>
              </div>
            </div>

            <div className="transaction-list">
              {loading ? (
                <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>Syncing with Supabase...</p>
              ) : (
                <>
                  {transactions.map((t) => (
                    <div key={t.id} className="transaction-item">
                      <div className="transaction-info">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                          <h4 style={{ margin: 0 }}>{t.tier1_category}</h4>
                          {t.projects?.name && (
                            <span className="project-tag">
                              <Briefcase size={10} /> {t.projects.name}
                            </span>
                          )}
                        </div>
                        <p>{t.tier2_memo}</p>
                        <small style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                          {new Date(t.date).toLocaleDateString()} {t.behavioral_source && `• ${t.behavioral_source}`}
                        </small>
                      </div>
                      <div className={`transaction-amount ${t.type === 'inflow' ? 'positive' : 'negative'}`}>
                        {t.type === 'inflow' ? '+' : '-'}₹{Number(t.amount).toLocaleString()}
                      </div>
                    </div>
                  ))}
                  {transactions.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>No records found.</p>}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
