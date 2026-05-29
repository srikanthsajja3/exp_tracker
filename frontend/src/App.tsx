import React, { useState, useEffect } from 'react';
import { ArrowUpRight, ArrowDownRight, PlusCircle, LayoutDashboard, History, Filter } from 'lucide-react';
import { supabase } from './supabaseClient';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'input' | 'dashboard'>('input');
  const [type, setType] = useState<'inflow' | 'outflow'>('outflow');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [memo, setMemo] = useState('');
  const [source, setSource] = useState('regular');
  const [excludeTravel, setExcludeTravel] = useState(false);
  
  const [summary, setSummary] = useState({ gross_revenue: 0, gross_expenses: 0, net_profit: 0 });
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (activeTab === 'dashboard') {
      fetchData();
    }
  }, [activeTab, excludeTravel]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch Transactions
      let query = supabase
        .from('transactions')
        .select('*')
        .order('date', { ascending: false });

      if (excludeTravel) {
        query = query.neq('tier1_category', 'Travel');
      }

      const { data: transData, error: transError } = await query;
      if (transError) throw transError;
      setTransactions(transData || []);

      // Calculate Summary (Client-side Intelligence)
      const { data: allData, error: allError } = await supabase
        .from('transactions')
        .select('type, amount');
      
      if (allError) throw allError;

      const gross_revenue = allData
        ?.filter(t => t.type === 'inflow')
        .reduce((sum, t) => sum + Number(t.amount), 0) || 0;
      
      const gross_expenses = allData
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
  };

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
      date: new Date().toISOString()
    };

    try {
      const { error } = await supabase.from('transactions').insert([payload]);
      if (error) throw error;
      
      alert('Transaction saved to Ledger!');
      setAmount('');
      setCategory('');
      setMemo('');
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  return (
    <div className="container">
      <header style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h1 style={{ color: 'var(--accent-blue)', margin: 0 }}>FinControl</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button 
            onClick={() => setActiveTab('input')}
            className={`toggle-btn ${activeTab === 'input' ? 'active' : ''}`}
            style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}
          >
            <PlusCircle size={16} /> Add
          </button>
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`toggle-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}
          >
            <LayoutDashboard size={16} /> Data
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
                <label>{type === 'inflow' ? 'Source' : 'Category'}</label>
                {type === 'inflow' ? (
                  <select value={category} onChange={(e) => setCategory(e.target.value)} required>
                    <option value="">Select Source</option>
                    <option value="Salary">Salary</option>
                    <option value="Freelance">Freelance</option>
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
      ) : (
        <div>
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
              <div className="metric-label">Net Ledger</div>
              <div className="metric-value" style={{ color: summary.net_profit >= 0 ? 'var(--accent-inflow)' : 'var(--accent-outflow)' }}>
                ₹{summary.net_profit.toLocaleString()}
              </div>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <History size={20} /> Recent Logs
              </h2>
              <button 
                className={`toggle-btn ${excludeTravel ? 'active' : ''}`}
                style={{ width: 'auto', padding: '0.5rem 1rem', fontSize: '0.8rem' }}
                onClick={() => setExcludeTravel(!excludeTravel)}
              >
                <Filter size={14} /> {excludeTravel ? 'Regular View' : 'Travel Silo On'}
              </button>
            </div>

            <div className="transaction-list">
              {loading ? (
                <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Syncing with Supabase...</p>
              ) : (
                <>
                  {transactions.map((t) => (
                    <div key={t.id} className="transaction-item">
                      <div className="transaction-info">
                        <h4>{t.tier1_category}</h4>
                        <p>{t.tier2_memo}</p>
                        <small style={{ color: 'var(--text-secondary)' }}>
                          {new Date(t.date).toLocaleDateString()} {t.behavioral_source && `• ${t.behavioral_source}`}
                        </small>
                      </div>
                      <div className={`transaction-amount ${t.type === 'inflow' ? 'positive' : 'negative'}`}>
                        {t.type === 'inflow' ? '+' : '-'}₹{Number(t.amount).toLocaleString()}
                      </div>
                    </div>
                  ))}
                  {transactions.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No records found.</p>}
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
