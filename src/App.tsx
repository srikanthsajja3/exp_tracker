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

interface GeneralReminder {
  id: string;
  title: string;
  body: string;
  type: 'daily' | 'one-off';
  reminder_time?: string;
  reminder_date?: string;
}

interface ParsedTx {
  id: string;
  date: string;
  details: string;
  type: 'inflow' | 'outflow';
  amount: number;
  txId: string;
  utr: string;
  account: string;
  selected: boolean;
  category: string;
  projectId: string;
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
      <div style={{ position: 'relative', width: '100%', maxWidth: size, aspectRatio: '1/1', margin: '0 auto' }}>
        <svg viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)', width: '100%', height: '100%' }}>
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

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'input' | 'dashboard' | 'recurring' | 'alerts'>('input');
  const [type, setType] = useState<'inflow' | 'outflow'>('outflow');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [memo, setMemo] = useState('');
  const [source, setSource] = useState('regular');
  const [excludeTravel, setExcludeTravel] = useState(false);
  const [transactionDate, setTransactionDate] = useState(() => new Date().toISOString().split('T')[0]);

  // General Custom Reminders State
  const [reminders, setReminders] = useState<GeneralReminder[]>([]);
  const [remTitle, setRemTitle] = useState('');
  const [remBody, setRemBody] = useState('');
  const [remType, setRemType] = useState<'daily' | 'one-off'>('daily');
  const [remTime, setRemTime] = useState('20:00');
  const [remDate, setRemDate] = useState(() => new Date().toISOString().split('T')[0]);

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [dateRange, setDateRange] = useState<'thisMonth' | 'lastMonth' | 'all'>('thisMonth');
  const [budget, setBudget] = useState<number>(() => {
    const saved = Number(localStorage.getItem('fin_budget'));
    return (saved && saved >= 10000) ? saved : 50000;
  });

  const [summary, setSummary] = useState({ gross_revenue: 0, gross_expenses: 0, net_profit: 0 });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [plannedItems, setPlannedItems] = useState<PlannedMovement[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Modal states for partial/full payment
  const [settlingItem, setSettlingItem] = useState<PlannedMovement | null>(null);
  const [settleAmount, setSettleAmount] = useState('');

  // PhonePe PDF import states
  const [inputMode, setInputMode] = useState<'manual' | 'phonepe'>('manual');
  const [parsedTxs, setParsedTxs] = useState<ParsedTx[]>([]);
  const [pdfPassword, setPdfPassword] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfFileBuffer, setPdfFileBuffer] = useState<ArrayBuffer | null>(null);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [parsingError, setParsingError] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission === 'granted';
    }
    return false;
  });

  const subscribeToPushNotifications = useCallback(async (isManual = false) => {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    try {
      const registration = await navigator.serviceWorker.ready;
      const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
      
      if (vapidPublicKey) {
        try {
          const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
          });
          
          // Save subscription to Supabase with timezone
          const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
          const { error } = await supabase
            .from('push_subscriptions')
            .upsert(
              { subscription, timezone },
              { onConflict: 'endpoint' }
            );
          
          if (error) {
            console.error('Error saving subscription to Supabase:', error);
            if (isManual) alert('Supabase error: ' + error.message);
          } else {
            console.log('Push subscription saved successfully');
            if (isManual) alert('Push subscription saved successfully to Supabase!');
          }
        } catch (subscribeErr) {
          console.error('Failed to subscribe to push notifications:', subscribeErr);
          if (isManual) alert('Subscribe error: ' + (subscribeErr as Error).message);
        }
      } else {
        console.warn('VITE_VAPID_PUBLIC_KEY is not defined in environment variables.');
        if (isManual) alert('VAPID public key is missing from environment!');
      }
    } catch (err) {
      console.error('Error in serviceWorker.ready:', err);
    }
  }, []);

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) {
      alert('This browser does not support notifications.');
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        setPushEnabled(true);
        await subscribeToPushNotifications(true);
        
        new Notification("FinControl", { 
          body: "Notifications are now active!",
          icon: "/favicon.svg"
        });
      } else {
        alert('Notification permission denied.');
      }
    } catch (err) {
      console.error('Error during notification setup:', err);
      alert('Failed to set up notifications: ' + (err as Error).message);
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      subscribeToPushNotifications(false);
    }
  }, [subscribeToPushNotifications]);

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

  const fetchReminders = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('general_reminders')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setReminders(data || []);
    } catch (err) {
      console.error('Error fetching reminders:', err);
    }
  }, []);

  const deleteReminder = async (id: string) => {
    try {
      const { error } = await supabase
        .from('general_reminders')
        .delete()
        .eq('id', id);
      if (error) throw error;
      fetchReminders();
    } catch (err) {
      alert('Error deleting reminder: ' + (err as Error).message);
    }
  };

  const handleReminderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        title: remTitle,
        body: remBody,
        type: remType,
        reminder_time: remTime,
        reminder_date: remType === 'one-off' ? remDate : null,
      };
      const { error } = await supabase
        .from('general_reminders')
        .insert([payload]);
      
      if (error) throw error;
      
      setRemTitle('');
      setRemBody('');
      fetchReminders();
      alert('Reminder added successfully!');
    } catch (err) {
      alert('Error adding reminder: ' + (err as Error).message);
    }
  };

  const getSuggestedCategory = (details: string, type: 'inflow' | 'outflow') => {
    const text = details.toLowerCase();
    if (type === 'inflow') return 'Income';
    
    if (text.includes('google') || text.includes('netflix') || text.includes('spotify') || text.includes('recharge') || text.includes('broadband')) {
      return 'Bills';
    }
    if (text.includes('swiggy') || text.includes('zomato') || text.includes('zepto') || text.includes('dabha') || text.includes('mess') || text.includes('bake') || text.includes('restaurant') || text.includes('food') || text.includes('tea')) {
      return 'Food';
    }
    if (text.includes('ola') || text.includes('uber') || text.includes('apsrtc') || text.includes('metro') || text.includes('fuel') || text.includes('petrol') || text.includes('travel') || text.includes('wash')) {
      return 'Travel';
    }
    if (text.includes('footwear') || text.includes('mart') || text.includes('traders') || text.includes('amazon') || text.includes('flipkart') || text.includes('myntra') || text.includes('clothing')) {
      return 'Shopping';
    }
    return 'Miscellaneous';
  };

  const extractPhonePeTransactions = (text: string): ParsedTx[] => {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const txs: ParsedTx[] = [];
    
    let i = 0;
    let idx = 0;
    while (i < lines.length) {
      const dateMatch = lines[i].match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2},\s+\d{4}$/);
      if (!dateMatch) {
        i++;
        continue;
      }
      const date = lines[i];
      
      if (i + 1 >= lines.length) break;
      const timeMatch = lines[i+1].match(/^\d{2}:\d{2}\s+(AM|PM)$/);
      if (!timeMatch) {
        i++;
        continue;
      }
      const time = lines[i+1];
      
      if (i + 2 >= lines.length) break;
      const details = lines[i+2];
      
      let txId = '';
      let utr = '';
      let account = '';
      let amountLine = '';
      
      let j = i + 3;
      while (j < Math.min(i + 10, lines.length)) {
        const line = lines[j];
        if (line.startsWith('Transaction ID :')) {
          txId = line.replace('Transaction ID :', '').trim();
        } else if (line.startsWith('UTR No :')) {
          utr = line.replace('UTR No :', '').trim();
        } else if (line.startsWith('Credited to') || line.startsWith('Debited from')) {
          account = line.trim();
        } else if (line.match(/^(Credit|Debit) INR\s+/)) {
          amountLine = line;
          break;
        }
        j++;
      }
      
      if (amountLine) {
        const amountMatch = amountLine.match(/^(Credit|Debit) INR\s+([\d,.]+)/);
        if (amountMatch) {
          const type = amountMatch[1] === 'Credit' ? 'inflow' : 'outflow';
          const amount = parseFloat(amountMatch[2].replace(/,/g, ''));
          
          let title = details;
          if (title.startsWith('Paid to ')) {
            title = title.replace('Paid to ', '');
          } else if (title.startsWith('Received from ')) {
            title = title.replace('Received from ', '');
          }
          
          let parsedDateString = `${date} ${time}`;
          let isoDate = new Date().toISOString();
          try {
            const parsedDate = new Date(parsedDateString);
            if (!isNaN(parsedDate.getTime())) {
              isoDate = parsedDate.toISOString();
            }
          } catch (e) {}
          
          txs.push({
            id: `tx_${idx++}`,
            date: isoDate,
            details: title,
            type,
            amount,
            txId,
            utr,
            account,
            selected: true,
            category: getSuggestedCategory(title, type),
            projectId: ''
          });
        }
        i = j + 1;
      } else {
        i++;
      }
    }
    
    return txs;
  };

  const loadScript = (src: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject();
      document.head.appendChild(script);
    });
  };

  const parsePdfBuffer = async (buffer: ArrayBuffer, password = '') => {
    setIsParsing(true);
    setParsingError('');
    
    if (!(window as any).pdfjsLib) {
      try {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js');
        (window as any).pdfjsLib = (window as any)['pdfjs-dist/build/pdf'];
        (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
      } catch (err) {
        setParsingError('Failed to load PDF parser. Please check your internet connection.');
        setIsParsing(false);
        return;
      }
    }
    
    const pdfjsLib = (window as any).pdfjsLib;
    
    try {
      const loadingTask = pdfjsLib.getDocument({
        data: buffer,
        password: password
      });
      
      const pdf = await loadingTask.promise;
      let fullText = '';
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join('\n');
        fullText += pageText + '\n';
      }
      
      const txs = extractPhonePeTransactions(fullText);
      setParsedTxs(txs);
      setPasswordRequired(false);
    } catch (err: any) {
      if (err.name === 'PasswordException' || err.code === 1) {
        setPasswordRequired(true);
      } else {
        console.error(err);
        setParsingError('Error parsing PDF: ' + err.message);
      }
    } finally {
      setIsParsing(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setPdfFile(file);
    setParsingError('');
    setPasswordRequired(false);
    setPdfPassword('');
    
    const reader = new FileReader();
    reader.onload = async () => {
      const buffer = reader.result as ArrayBuffer;
      setPdfFileBuffer(buffer);
      await parsePdfBuffer(buffer, '');
    };
    reader.readAsArrayBuffer(file);
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pdfFileBuffer) return;
    await parsePdfBuffer(pdfFileBuffer, pdfPassword);
  };

  const handleImportSubmit = async () => {
    const selectedTxs = parsedTxs.filter(t => t.selected);
    if (selectedTxs.length === 0) {
      alert('No transactions selected.');
      return;
    }
    
    setLoading(true);
    try {
      const payloads = selectedTxs.map(t => ({
        type: t.type,
        amount: t.amount,
        date: t.date,
        tier1_category: t.category,
        tier2_memo: `${t.details} (PhonePe UTR: ${t.utr})`,
        project_id: t.projectId || null
      }));
      
      const { error } = await supabase
        .from('transactions')
        .insert(payloads);
        
      if (error) throw error;
      
      alert(`Successfully imported ${payloads.length} transactions into the ledger!`);
      setParsedTxs([]);
      setPdfFile(null);
      setPdfFileBuffer(null);
      setInputMode('manual');
      fetchData();
    } catch (err: any) {
      alert('Error importing transactions: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

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

      // 4. Calculate Summary (Excludes zero-cost Pass-Through Flow to reflect real earned income & expenses)
      const gross_revenue = (transData as Transaction[])
        ?.filter(t => t.type === 'inflow' && t.tier1_category !== 'Pass-Through Flow')
        .reduce((sum, t) => sum + Number(t.amount), 0) || 0;
      
      const gross_expenses = (transData as Transaction[])
        ?.filter(t => t.type === 'outflow' && t.tier1_category !== 'Pass-Through Flow')
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
    if (activeTab === 'alerts') {
      fetchReminders();
    }
  }, [activeTab, fetchData, fetchReminders]);

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

  const handleRepaySubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!settlingItem) return;
    
    const amountToPay = parseFloat(settleAmount);
    if (isNaN(amountToPay) || amountToPay <= 0) {
      alert('Please enter a valid amount.');
      return;
    }
    if (amountToPay > settlingItem.amount) {
      alert('Repayment amount cannot exceed the outstanding amount.');
      return;
    }

    try {
      const isFullPayment = amountToPay === settlingItem.amount;

      if (isFullPayment) {
        // 1. Mark as paid
        const { error: updateError } = await supabase
          .from('planned_movements')
          .update({ status: 'paid' })
          .eq('id', settlingItem.id);
        if (updateError) throw updateError;
      } else {
        // 2. Partial payment: Update amount in planned_movements
        const remainingAmount = settlingItem.amount - amountToPay;
        const { error: updateError } = await supabase
          .from('planned_movements')
          .update({ amount: remainingAmount })
          .eq('id', settlingItem.id);
        if (updateError) throw updateError;
      }

      // 3. Log the transaction in the ledger
      const payload = {
        type: settlingItem.type === 'debt_given' ? 'inflow' : 'outflow',
        amount: amountToPay,
        tier1_category: settlingItem.type === 'subscription' ? 'Bills' : 'Debt',
        tier2_memo: isFullPayment 
          ? `Settled: ${settlingItem.title}` 
          : `Partial Settle: ${settlingItem.title} (Remaining: ₹${(settlingItem.amount - amountToPay).toLocaleString()})`,
        date: new Date().toISOString()
      };
      const { error: insertError } = await supabase.from('transactions').insert([payload]);
      if (insertError) throw insertError;

      setSettlingItem(null);
      fetchData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const markAsPaid = async (item: PlannedMovement) => {
    if (item.type === 'subscription') {
      try {
        // Mark as paid
        const { error: updateError } = await supabase
          .from('planned_movements')
          .update({ status: 'paid' })
          .eq('id', item.id);
        
        if (updateError) throw updateError;

        // Log actual transaction
        const payload = {
          type: 'outflow',
          amount: item.amount,
          tier1_category: 'Bills',
          tier2_memo: `Settled: ${item.title}`,
          date: new Date().toISOString()
        };
        await supabase.from('transactions').insert([payload]);

        // If recurring, create next month's entry
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
    } else {
      // It's a debt, open modal for full or partial repayment
      setSettlingItem(item);
      setSettleAmount(item.amount.toString());
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

  const deleteTransaction = async (id: string) => {
    if (!confirm('Delete this transaction record?')) return;
    try {
      const { error } = await supabase.from('transactions').delete().eq('id', id);
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
        <div className="header-nav" style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.05)', padding: '0.4rem', borderRadius: '14px', border: '1px solid var(--border)' }}>
          <button 
            onClick={() => setActiveTab('alerts')}
            className={`toggle-btn ${activeTab === 'alerts' ? 'active' : ''}`}
            style={{ padding: '0.5rem 0.75rem' }}
            title="Notification Center"
          >
            <Bell size={18} />
          </button>
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

      {/* Mobile Bottom Navigation */}
      <nav className="mobile-nav">
        <button 
          className={`nav-item ${activeTab === 'input' ? 'active' : ''}`}
          onClick={() => setActiveTab('input')}
        >
          <PlusCircle size={22} />
          <span>Add</span>
        </button>
        <button 
          className={`nav-item ${activeTab === 'recurring' ? 'active' : ''}`}
          onClick={() => setActiveTab('recurring')}
        >
          <Calendar size={22} />
          <span>Plans</span>
        </button>
        <button 
          className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          <LayoutDashboard size={22} />
          <span>Data</span>
        </button>
        <button 
          className={`nav-item ${activeTab === 'alerts' ? 'active' : ''}`}
          onClick={() => setActiveTab('alerts')}
        >
          <Bell size={22} />
          <span>Alerts</span>
        </button>
      </nav>

      {activeTab === 'input' ? (
        <div>
          {/* Sub Tab Toggle (Manual vs PhonePe) */}
          <div className="toggle-container" style={{ marginBottom: '1.5rem' }}>
            <button 
              type="button" 
              className={`toggle-btn ${inputMode === 'manual' ? 'active' : ''}`}
              onClick={() => setInputMode('manual')}
            >
              Manual Log
            </button>
            <button 
              type="button" 
              className={`toggle-btn ${inputMode === 'phonepe' ? 'active' : ''}`}
              onClick={() => setInputMode('phonepe')}
            >
              Import PhonePe PDF
            </button>
          </div>

          {inputMode === 'manual' ? (
            <div className="card" style={{ marginTop: 0 }}>
              <h2 style={{ marginBottom: '1.5rem' }}>Record Movement</h2>
              
              <div className="toggle-container">
                <button 
                  type="button"
                  className={`toggle-btn ${type === 'inflow' ? 'active inflow' : ''}`}
                  onClick={() => setType('inflow')}
                >
                  <ArrowUpRight size={20} /> Earned
                </button>
                <button 
                  type="button"
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

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <div className="input-group">
                      <label>Tier 1 Category</label>
                      {type === 'inflow' ? (
                        <select value={category} onChange={(e) => setCategory(e.target.value)} required>
                          <option value="">Select Category</option>
                          <option value="Income">Salary / Income</option>
                          <option value="Passive">Passive Income</option>
                          <option value="Bonus">Bonus / Payout</option>
                          <option value="Reimbursement">Reimbursement</option>
                        </select>
                      ) : (
                        <select value={category} onChange={(e) => setCategory(e.target.value)} required>
                          <option value="">Select Category</option>
                          <option value="Food">Food / Dining</option>
                          <option value="Travel">Travel / Transport</option>
                          <option value="Shopping">Shopping / Clothing</option>
                          <option value="Bills">Bills / Recharges</option>
                          <option value="Miscellaneous">Miscellaneous</option>
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
                </div>
              </form>
            </div>
          ) : (
            <div className="card" style={{ marginTop: 0 }}>
              <h2 style={{ marginBottom: '1.5rem' }}>Import PhonePe Statement</h2>
              
              <div className="input-group">
                <label>Select PhonePe PDF Statement</label>
                <input 
                  type="file" 
                  accept="application/pdf" 
                  onChange={handleFileChange}
                  style={{ padding: '0.5rem' }}
                />
              </div>

              {pdfFile && (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '-0.75rem', marginBottom: '1.25rem' }}>
                  Selected File: <strong>{pdfFile.name}</strong>
                </p>
              )}

              {isParsing && (
                <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1.5rem 0' }}>
                  Decrypting and parsing PDF statement...
                </p>
              )}

              {passwordRequired && (
                <form onSubmit={handlePasswordSubmit} style={{ background: 'rgba(255, 77, 77, 0.05)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--accent-outflow)', marginBottom: '1.5rem' }}>
                  <p style={{ fontSize: '0.85rem', color: 'var(--accent-outflow)', marginTop: 0, marginBottom: '0.75rem', fontWeight: 600 }}>
                    This PDF is encrypted. Enter your PhonePe password (typically your 10-digit registered mobile number):
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input 
                      type="password" 
                      value={pdfPassword} 
                      onChange={(e) => setPdfPassword(e.target.value)} 
                      placeholder="e.g. 9133095695"
                      required
                      style={{ background: 'rgba(0,0,0,0.4)', flex: 1 }}
                    />
                    <button type="submit" className="btn-primary" style={{ width: 'auto', margin: 0, padding: '0.75rem 1.5rem' }}>
                      Unlock
                    </button>
                  </div>
                </form>
              )}

              {parsingError && (
                <p style={{ color: 'var(--accent-outflow)', fontSize: '0.85rem', marginBottom: '1.5rem', fontWeight: 600 }}>
                  {parsingError}
                </p>
              )}

              {parsedTxs.length > 0 && (
                <div style={{ marginTop: '1.5rem' }}>
                  <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>Review Transactions ({parsedTxs.length} items found)</h3>
                  
                  <div className="transaction-list" style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '12px', padding: '0.5rem', marginBottom: '1.5rem' }}>
                    {parsedTxs.map((tx, idx) => (
                      <div key={tx.id} className="transaction-item" style={{ display: 'flex', gap: '0.75rem', padding: '0.75rem 0' }}>
                        <input 
                          type="checkbox" 
                          checked={tx.selected}
                          onChange={(e) => {
                            const copy = [...parsedTxs];
                            copy[idx].selected = e.target.checked;
                            setParsedTxs(copy);
                          }}
                          style={{ width: '20px', height: '20px', cursor: 'pointer', alignSelf: 'center' }}
                        />
                        
                        <div style={{ flex: 1 }}>
                          <h4 style={{ margin: 0, fontSize: '0.9rem' }}>{tx.details}</h4>
                          <small style={{ color: 'var(--text-secondary)', display: 'block', margin: '0.1rem 0' }}>
                            {new Date(tx.date).toLocaleDateString()} • {tx.account}
                          </small>
                          
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem', marginTop: '0.4rem' }}>
                            <select 
                              value={tx.category} 
                              onChange={(e) => {
                                const copy = [...parsedTxs];
                                copy[idx].category = e.target.value;
                                setParsedTxs(copy);
                              }}
                              style={{ fontSize: '0.75rem', padding: '0.25rem' }}
                            >
                              <option value="Food">Food / Dining</option>
                              <option value="Travel">Travel / Transport</option>
                              <option value="Bills">Bills / Recharges</option>
                              <option value="Shopping">Shopping / Clothing</option>
                              <option value="Income">Income</option>
                              <option value="Miscellaneous">Miscellaneous</option>
                              <option value="Health">Health</option>
                              <option value="Investment">Investment</option>
                            </select>
                            
                            <select 
                              value={tx.projectId} 
                              onChange={(e) => {
                                const copy = [...parsedTxs];
                                copy[idx].projectId = e.target.value;
                                setParsedTxs(copy);
                              }}
                              style={{ fontSize: '0.75rem', padding: '0.25rem' }}
                            >
                              <option value="">No Project</option>
                              {projects.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className={`transaction-amount ${tx.type === 'inflow' ? 'positive' : 'negative'}`} style={{ alignSelf: 'center', fontSize: '0.95rem' }}>
                          {tx.type === 'inflow' ? '+' : '-'}₹{tx.amount.toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>

                  <button 
                    type="button" 
                    className="btn-primary"
                    onClick={handleImportSubmit}
                    disabled={loading}
                  >
                    {loading ? 'Importing...' : `Import Selected (${parsedTxs.filter(t => t.selected).length} transactions)`}
                  </button>
                </div>
              )}
            </div>
          )}
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
                    <input type="number" value={pAmount} onChange={(e) => setPAmount(e.target.value)} placeholder="0.00" inputMode="decimal" required />
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
      ) : activeTab === 'alerts' ? (
        <div>
          {/* Web Push Subscription / Status Section */}
          <div className="card">
            <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Bell size={20} /> Web Push Notification Status
            </h2>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div>
                <p style={{ margin: 0, fontWeight: 600, color: pushEnabled ? 'var(--accent-inflow)' : 'var(--accent-outflow)' }}>
                  {pushEnabled ? 'Push Status: Active (Subscribed)' : 'Push Status: Inactive'}
                </p>
                <small style={{ color: 'var(--text-secondary)' }}>
                  {pushEnabled 
                    ? 'Your device is registered to receive background notifications in the cloud.' 
                    : 'Subscribe to get alerts even when the application is closed.'}
                </small>
              </div>
              <button 
                type="button" 
                onClick={requestNotificationPermission} 
                className="toggle-btn"
                style={{ width: 'auto', padding: '0.6rem 1rem', background: pushEnabled ? 'rgba(46, 204, 113, 0.15)' : 'var(--accent-blue)', color: '#fff', border: 'none' }}
              >
                {pushEnabled ? 'Sync Subscription' : 'Enable Push'}
              </button>
            </div>
          </div>

          {/* Add Custom Reminder Form */}
          <div className="card">
            <h2 style={{ marginBottom: '1.5rem' }}>Add Custom Reminder</h2>
            <form onSubmit={handleReminderSubmit}>
              <div className="toggle-container" style={{ marginBottom: '1rem' }}>
                <button 
                  type="button" 
                  className={`toggle-btn ${remType === 'daily' ? 'active' : ''}`} 
                  onClick={() => setRemType('daily')}
                >
                  Daily
                </button>
                <button 
                  type="button" 
                  className={`toggle-btn ${remType === 'one-off' ? 'active' : ''}`} 
                  onClick={() => setRemType('one-off')}
                >
                  One-time Date
                </button>
              </div>

              <div className="input-grid" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div className="input-group">
                  <label>Title</label>
                  <input 
                    type="text" 
                    value={remTitle} 
                    onChange={(e) => setRemTitle(e.target.value)} 
                    placeholder="e.g. Daily Check-in" 
                    required 
                  />
                </div>
                <div className="input-group">
                  <label>Message Content</label>
                  <input 
                    type="text" 
                    value={remBody} 
                    onChange={(e) => setRemBody(e.target.value)} 
                    placeholder="e.g. Please log your transactions for today!" 
                    required 
                  />
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  {remType === 'daily' ? (
                    <div className="input-group">
                      <label>Time of Day</label>
                      <input 
                        type="time" 
                        value={remTime} 
                        onChange={(e) => setRemTime(e.target.value)} 
                        required 
                      />
                    </div>
                  ) : (
                    <>
                      <div className="input-group">
                        <label>Date</label>
                        <input 
                          type="date" 
                          value={remDate} 
                          onChange={(e) => setRemDate(e.target.value)} 
                          required 
                        />
                      </div>
                      <div className="input-group">
                        <label>Time</label>
                        <input 
                          type="time" 
                          value={remTime} 
                          onChange={(e) => setRemTime(e.target.value)} 
                          required 
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
              <button type="submit" className="btn-primary" style={{ marginTop: '1rem' }}>Add Reminder</button>
            </form>
          </div>

          {/* List of Custom Reminders */}
          <div className="card">
            <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={20} /> Active Reminders
            </h2>
            <div className="transaction-list">
              {reminders.map(rem => (
                <div key={rem.id} className="transaction-item">
                  <div className="transaction-info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <h4 style={{ margin: 0 }}>{rem.title}</h4>
                      <span className="project-tag" style={{ fontSize: '0.6rem', padding: '0.2rem 0.4rem' }}>
                        {rem.type === 'daily' ? 'Daily' : 'One-time'}
                      </span>
                    </div>
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{rem.body}</p>
                    <small style={{ color: 'var(--text-secondary)', display: 'block', marginTop: '0.25rem' }}>
                      Scheduled: {rem.type === 'daily' 
                        ? `Every day at ${rem.reminder_time?.substring(0, 5)}` 
                        : `${new Date(rem.reminder_date || '').toLocaleDateString()} at ${rem.reminder_time?.substring(0, 5)}`}
                    </small>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <button 
                      onClick={() => deleteReminder(rem.id)} 
                      style={{ background: 'none', border: 'none', color: 'var(--accent-outflow)', cursor: 'pointer' }} 
                      title="Delete"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>
              ))}
              {reminders.length === 0 && (
                <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem' }}>No custom reminders scheduled.</p>
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

          {/* SEPARATED CATEGORY BREAKDOWNS & ITEMIZED DETAILS */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Separated Financial Portfolios & Details
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
              
              {/* 1. Real Earned Income & Revenues */}
              <div className="card" style={{ margin: 0, border: '1px solid rgba(46, 204, 113, 0.3)', background: 'linear-gradient(135deg, rgba(46, 204, 113, 0.05), transparent)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--accent-inflow)' }}>💰 Real Earned Revenue</h3>
                  <span style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent-inflow)' }}>
                    ₹{(transactions.filter(t => t.type === 'inflow' && t.tier1_category === 'Income').reduce((s,t) => s + Number(t.amount), 0)).toLocaleString()}
                  </span>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  Genuine salary & client revenue earned (excludes pass-throughs & debt repayments).
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.82rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                    <span>Moksha Jewels Salary</span>
                    <strong>₹22,542</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                    <span>Naga Sobh Client Pay</span>
                    <strong>₹15,000</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                    <span>Golla Sudhakar Client Pay</span>
                    <strong>₹3,000</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                    <span>PhonePe Auto-Refund</span>
                    <strong>₹5</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'rgba(46, 204, 113, 0.1)', borderRadius: '6px', marginTop: '0.25rem' }}>
                    <span>Friend Repayments Recv (Sazad)</span>
                    <strong style={{ color: 'var(--accent-inflow)' }}>+₹560</strong>
                  </div>
                </div>
              </div>

              {/* 2. Friend Debts Asset Tracker */}
              <div className="card" style={{ margin: 0, border: '1px solid rgba(52, 152, 219, 0.3)', background: 'linear-gradient(135deg, rgba(52, 152, 219, 0.05), transparent)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--accent-blue)' }}>🤝 Friend Debt Receivables</h3>
                  <span style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent-blue)' }}>₹14,132</span>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  Net money owed to you by friends (Asset portfolio balance).
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.82rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                    <div>
                      <span>Shaik Sazad</span>
                      <small style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Net after ₹560 repayment</small>
                    </div>
                    <strong style={{ color: 'var(--accent-blue)' }}>₹8,000</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                    <div>
                      <span>Panchakarla Kamal</span>
                      <small style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Outstanding Loan</small>
                    </div>
                    <strong style={{ color: 'var(--accent-blue)' }}>₹5,030</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                    <div>
                      <span>Panditi Dinesh Babu</span>
                      <small style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Personal Debt</small>
                    </div>
                    <strong style={{ color: 'var(--accent-blue)' }}>₹1,102</strong>
                  </div>
                </div>
              </div>

              {/* 3. Real Personal Expenses */}
              <div className="card" style={{ margin: 0, border: '1px solid rgba(231, 76, 60, 0.3)', background: 'linear-gradient(135deg, rgba(231, 76, 60, 0.05), transparent)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--accent-outflow)' }}>🛍️ Real Personal Living Cost</h3>
                  <span style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent-outflow)' }}>
                    ₹{(transactions.filter(t => t.type === 'outflow' && t.tier1_category !== 'Pass-Through Flow' && t.tier1_category !== 'Debt').reduce((s,t) => s + Number(t.amount), 0)).toLocaleString()}
                  </span>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  Actual personal consumption (excludes friend debt advances & pass-throughs).
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.82rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                    <span>Major Home Asset Share (AC)</span>
                    <strong style={{ color: 'var(--accent-outflow)' }}>₹5,660</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                    <span>Food & Dining</span>
                    <strong style={{ color: 'var(--accent-outflow)' }}>₹2,928</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                    <span>Fuel & Transportation</span>
                    <strong style={{ color: 'var(--accent-outflow)' }}>₹475</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                    <span>Digital Subscriptions</span>
                    <strong style={{ color: 'var(--accent-outflow)' }}>₹90</strong>
                  </div>
                </div>
              </div>

              {/* 4. Pass-Through Conversions */}
              <div className="card" style={{ margin: 0, border: '1px solid rgba(155, 89, 182, 0.3)', background: 'linear-gradient(135deg, rgba(155, 89, 182, 0.05), transparent)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#9b59b6' }}>🔄 Pass-Through Exchanges</h3>
                  <span style={{ fontWeight: 700, fontSize: '1.1rem', color: '#9b59b6' }}>₹8,380</span>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  Zero net cost cash-for-online currency conversions.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.82rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                    <div>
                      <span>Dinesh Cash Exchange</span>
                      <small style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Online Sent ₹6k → Cash Received ₹6k</small>
                    </div>
                    <strong style={{ color: '#9b59b6' }}>₹6,000</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                    <div>
                      <span>Siddik Be Cash Exchange</span>
                      <small style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Cash Given ₹1.88k → Online Recv ₹1.88k</small>
                    </div>
                    <strong style={{ color: '#9b59b6' }}>₹1,880</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                    <div>
                      <span>Stranger Cash Exchange</span>
                      <small style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Cash Given ₹500 → Online Recv ₹500</small>
                    </div>
                    <strong style={{ color: '#9b59b6' }}>₹500</strong>
                  </div>
                </div>
              </div>

              {/* 5. Physical Cash-in-Hand Wallet Tracker */}
              <div className="card" style={{ margin: 0, border: '1px solid rgba(241, 196, 15, 0.3)', background: 'linear-gradient(135deg, rgba(241, 196, 15, 0.05), transparent)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#f1c40f' }}>💵 Physical Cash Balance</h3>
                  <span style={{ fontWeight: 700, fontSize: '1.1rem', color: '#f1c40f' }}>₹3,820</span>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  Physical currency currently held in wallet/hand.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.82rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                    <span>Total Cash Received</span>
                    <strong style={{ color: 'var(--accent-inflow)' }}>+₹9,880</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                    <span>Total Cash Spent (AC Share + Food)</span>
                    <strong style={{ color: 'var(--accent-outflow)' }}>-₹6,060</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'rgba(241, 196, 15, 0.15)', borderRadius: '6px', marginTop: '0.25rem' }}>
                    <span>Net Remaining Cash in Hand</span>
                    <strong style={{ color: '#f1c40f' }}>₹3,820</strong>
                  </div>
                </div>
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div className={`transaction-amount ${t.type === 'inflow' ? 'positive' : 'negative'}`}>
                          {t.type === 'inflow' ? '+' : '-'}₹{Number(t.amount).toLocaleString()}
                        </div>
                        <button 
                          onClick={() => deleteTransaction(t.id)} 
                          style={{ background: 'none', border: 'none', color: 'var(--accent-outflow)', cursor: 'pointer', display: 'flex', alignItems: 'center' }} 
                          title="Delete transaction"
                        >
                          <Trash2 size={18} />
                        </button>
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

      {settlingItem && (
        <div className="modal-overlay" onClick={() => setSettlingItem(null)}>
          <div className="card modal-content" style={{ maxWidth: '400px', width: '100%', margin: '0 auto' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: '1rem' }}>Settle planned movement</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              {settlingItem.title} • Current outstanding balance: <strong>₹{settlingItem.amount.toLocaleString()}</strong>
            </p>
            
            <form onSubmit={handleRepaySubmit}>
              <div className="input-group">
                <label>Repayment Amount (₹)</label>
                <input 
                  type="number" 
                  value={settleAmount} 
                  onChange={(e) => setSettleAmount(e.target.value)} 
                  placeholder="0.00"
                  inputMode="decimal"
                  required 
                />
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
                <button 
                  type="button" 
                  className="toggle-btn" 
                  style={{ width: 'auto', padding: '0.5rem 1rem' }}
                  onClick={() => setSettlingItem(null)}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn-primary" 
                  style={{ width: 'auto', padding: '0.5rem 1.5rem', margin: 0 }}
                >
                  Confirm Settle
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
