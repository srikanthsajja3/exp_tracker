import Svg, { Circle, G } from 'react-native-svg';
import React, { useEffect, useState, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StatusBar,
  Platform,
  Linking,
  useColorScheme,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  Plus,
  Bell,
  FileText,
  MessageSquare,
  Trash2,
  CheckCircle,
  RefreshCw,
  Clock,
  Calendar,
  Layers,
  Check,
  X,
  Coffee,
  Car,
  ShoppingBag,
  Zap,
  CreditCard,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  BarChart3,
  Users,
  CheckCircle2,
  ArrowLeftRight,
  TrendingUp,
  UserPlus,
  Filter,
} from 'lucide-react-native';

import { supabase } from './supabaseClient';
import { registerForPushNotificationsAsync, scheduleLocalNotification } from './services/notificationService';
import { fetchBankTransactionsFromSMS, ParsedSmsTransaction, getSuggestedCategory } from './services/smsParserService';
import { pickAndParsePdfStatement, ParsedPdfTx } from './services/pdfParserService';

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
  project_id?: string | null;
}

interface GeneralReminder {
  id: string;
  title: string;
  body: string;
  type: 'daily' | 'one-off';
  reminder_time?: string;
  reminder_date?: string;
}

const ACCOUNTS = ['All', 'Canara Bank', 'PhonePe / UPI', 'HDFC Bank', 'Cash'];


// CATEGORY DONUT CHART (SVG)
interface DonutItem {
  category: string;
  amount: number;
  percentage: number;
  color: string;
}

const CategoryDonutChart: React.FC<{
  data: DonutItem[];
  total: number;
  theme: any;
}> = ({ data, total, theme }) => {
  const size = 150;
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let currentOffset = 0;

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', marginVertical: 14 }}>
      <Svg width={size} height={size}>
        <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={theme.surfaceElevated}
            strokeWidth={strokeWidth}
            fill="transparent"
          />
          {data.map((item, index) => {
            const strokeDasharray = `${(item.percentage / 100) * circumference} ${circumference}`;
            const strokeDashoffset = -currentOffset;
            currentOffset += (item.percentage / 100) * circumference;

            return (
              <Circle
                key={index}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={item.color}
                strokeWidth={strokeWidth}
                strokeDasharray={strokeDasharray}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="transparent"
              />
            );
          })}
        </G>
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <Text style={{ fontSize: 9, fontWeight: '700', color: theme.textTertiary, letterSpacing: 1.5 }}>
          TOTAL SPENT
        </Text>
        <Text style={{ fontSize: 17, fontWeight: '900', color: theme.textPrimary, marginTop: 2 }}>
          ₹{total.toLocaleString('en-IN')}
        </Text>
      </View>
    </View>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'stats' | 'input' | 'lending' | 'accounts'>('dashboard');
  const [loading, setLoading] = useState(true);

  // Core Data States
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [plannedItems, setPlannedItems] = useState<PlannedMovement[]>([]);
  const [reminders, setReminders] = useState<GeneralReminder[]>([]);
  const [budget, setBudget] = useState<number>(50000);

  // Account Filter State
  const [selectedAccount, setSelectedAccount] = useState<string>('All');
  const [txAccount, setTxAccount] = useState<string>('Canara Bank');

  // Stats & Calendar Filter States
  const [statsFilter, setStatsFilter] = useState<'today' | 'week' | 'month' | 'all'>('month');
  const [statsViewMode, setStatsViewMode] = useState<'cards' | 'calendar'>('cards');
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [selectedCalDate, setSelectedCalDate] = useState<string>(() => new Date().toISOString().split('T')[0]);

  // Form States (Manual Transaction)
  const [type, setType] = useState<'inflow' | 'outflow' | 'debt_given'>('outflow');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('General Expense');
  const [memo, setMemo] = useState('');
  const [borrowerName, setBorrowerName] = useState('');
  const [source, setSource] = useState('regular');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [transactionDate, setTransactionDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Lending / Debt Form States
  const [loanModalVisible, setLoanModalVisible] = useState(false);
  const [loanPerson, setLoanPerson] = useState('');
  const [loanAmount, setLoanAmount] = useState('');
  const [loanType, setLoanType] = useState<'debt_given' | 'debt_taken'>('debt_given');
  const [loanDueDate, setLoanDueDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [loanAccount, setLoanAccount] = useState('Canara Bank');
  const [lendingFilter, setLendingFilter] = useState<'all' | 'pending' | 'settled'>('pending');
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  // Form States (Reminder)
  const [remTitle, setRemTitle] = useState('');
  const [remBody, setRemBody] = useState('');
  const [remType, setRemType] = useState<'daily' | 'one-off'>('daily');
  const [remTime, setRemTime] = useState('20:00');
  const [remDate, setRemDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Modals
  const [smsModalVisible, setSmsModalVisible] = useState(false);
  const [parsedSmsList, setParsedSmsList] = useState<ParsedSmsTransaction[]>([]);
  const [scanningSms, setScanningSms] = useState(false);

  // Theme Detection (Auto Day/Night Monochrome)
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const theme = useMemo(() => ({
    isDark,
    bg: isDark ? '#000000' : '#F8F9FA',
    headerBg: isDark ? '#000000' : '#FFFFFF',
    surface: isDark ? '#0F0F0F' : '#FFFFFF',
    surfaceSubtle: isDark ? '#141414' : '#F1F3F5',
    surfaceElevated: isDark ? '#18181B' : '#E9ECEF',
    border: isDark ? '#18181B' : '#E5E7EB',
    borderSubtle: isDark ? '#222222' : '#F0F0F0',
    borderStrong: isDark ? '#27272A' : '#D1D5DB',
    textPrimary: isDark ? '#FFFFFF' : '#09090B',
    textSecondary: isDark ? '#A1A1AA' : '#64748B',
    textTertiary: isDark ? '#71717A' : '#94A3B8',
    textHint: isDark ? '#52525B' : '#94A3B8',
    buttonPrimaryBg: isDark ? '#FFFFFF' : '#09090B',
    buttonPrimaryText: isDark ? '#000000' : '#FFFFFF',
    inflowBg: isDark ? '#141414' : '#F0FDF4',
    inflowBorder: isDark ? '#222222' : '#DCFCE7',
    inflowText: isDark ? '#4ADE80' : '#16A34A',
    outflowBg: isDark ? '#141414' : '#FFF1F2',
    outflowBorder: isDark ? '#222222' : '#FFE4E6',
    outflowText: isDark ? '#FB7185' : '#E11D48',
    progressTrack: isDark ? '#1A1A1A' : '#E5E7EB',
    progressFill: isDark ? '#FFFFFF' : '#09090B',
    avatarBg: isDark ? '#18181B' : '#F4F4F5',
    avatarBorder: isDark ? '#27272A' : '#E5E7EB',
    avatarIcon: isDark ? '#FFFFFF' : '#09090B',
    chipActiveBg: isDark ? '#FFFFFF' : '#09090B',
    chipActiveText: isDark ? '#000000' : '#FFFFFF',
    chipInactiveBg: isDark ? '#141414' : '#F4F4F5',
    chipInactiveBorder: isDark ? '#262626' : '#E5E7EB',
    chipInactiveText: isDark ? '#A1A1AA' : '#64748B',
    modalOverlay: isDark ? 'rgba(0, 0, 0, 0.85)' : 'rgba(0, 0, 0, 0.45)',
    modalHandle: isDark ? '#2E2E2E' : '#D4D4D8',
    statusBar: isDark ? 'light-content' : 'dark-content',
    statusBarBg: isDark ? '#000000' : '#FFFFFF',
  }), [isDark]);

  const styles = useMemo(() => createStyles(theme), [theme]);

  useEffect(() => {
    loadCachedBudget();
    fetchInitialData();
    registerForPushNotificationsAsync();

    // Deep link handling for Pixel Quick Tap, Widgets, and SMS notifications
    const handleUrl = (event: { url: string }) => {
      handleDeepLink(event.url);
    };

    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink(url);
    });

    const subscription = Linking.addEventListener('url', handleUrl);
    return () => subscription.remove();
  }, []);

  const handleDeepLink = (url: string) => {
    if (!url) return;
    try {
      if (url.includes('scan-sms')) {
        handleScanSMS();
        return;
      }

      if (url.includes('quick-add')) {
        setActiveTab('input');
        const queryIdx = url.indexOf('?');
        if (queryIdx !== -1) {
          const queryString = url.substring(queryIdx + 1);
          const pairs = queryString.split('&');
          let pAmount = '';
          let pMemo = '';
          let pType = '';
          let pDate = '';

          for (const pair of pairs) {
            const [k, v] = pair.split('=');
            if (k === 'amount') pAmount = decodeURIComponent(v || '');
            if (k === 'memo') pMemo = decodeURIComponent(v || '');
            if (k === 'type') pType = decodeURIComponent(v || '');
            if (k === 'date') pDate = decodeURIComponent(v || '');
          }

          if (pAmount) setAmount(pAmount);
          if (pMemo) {
            setMemo(pMemo);
            const inferredType = pType === 'inflow' ? 'inflow' : 'outflow';
            setCategory(getSuggestedCategory(pMemo, inferredType));
          }
          if (pType === 'inflow' || pType === 'outflow') setType(pType as 'inflow' | 'outflow');
          if (pDate) setTransactionDate(pDate);

          Alert.alert(
            '⚡ Payment Detected',
            `Pre-filled ₹${pAmount || '0'} for ${pMemo || 'Transaction'}. Review and tap 'Save Transaction'.`
          );
        }
      }
    } catch (e) {
      console.log('Error handling deep link:', e);
    }
  };

  const loadCachedBudget = async () => {
    try {
      const savedBudget = await AsyncStorage.getItem('fin_budget');
      if (savedBudget) setBudget(Number(savedBudget));
    } catch (e) {}
  };

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      // Fetch Transactions
      const { data: txData, error: txErr } = await supabase
        .from('transactions')
        .select('*')
        .order('date', { ascending: false });

      if (txData && !txErr) {
        setTransactions(txData);
        await AsyncStorage.setItem('offline_tx', JSON.stringify(txData));
      } else {
        const cachedTx = await AsyncStorage.getItem('offline_tx');
        if (cachedTx) setTransactions(JSON.parse(cachedTx));
      }

      // Fetch Projects
      const { data: projData } = await supabase.from('projects').select('*');
      if (projData) setProjects(projData);

      // Fetch General Reminders
      const { data: remData, error: remErr } = await supabase
        .from('general_reminders')
        .select('*')
        .order('created_at', { ascending: false });

      if (remData && !remErr) {
        setReminders(remData);
        await AsyncStorage.setItem('offline_reminders', JSON.stringify(remData));
      } else {
        const cachedRem = await AsyncStorage.getItem('offline_reminders');
        if (cachedRem) setReminders(JSON.parse(cachedRem));
      }

      // Fetch Planned Movements (Subscriptions / Debts)
      const { data: planData, error: planErr } = await supabase
        .from('planned_movements')
        .select('*')
        .order('due_date', { ascending: true });

      if (planData && !planErr) {
        setPlannedItems(planData);
        await AsyncStorage.setItem('offline_planned', JSON.stringify(planData));
      } else {
        const cachedPlan = await AsyncStorage.getItem('offline_planned');
        if (cachedPlan) setPlannedItems(JSON.parse(cachedPlan));
      }
    } catch (e) {
      console.log('Using offline cache where available');
    } finally {
      setLoading(false);
    }
  };

  // Helper: Extract or Infer Account for each transaction
  const getAccountForTx = (t: Transaction): string => {
    if (t.behavioral_source) return t.behavioral_source;
    const m = (t.tier2_memo || '').toLowerCase();
    if (m.includes('canara')) return 'Canara Bank';
    if (m.includes('hdfc')) return 'HDFC Bank';
    if (m.includes('phonepe') || m.includes('upi')) return 'PhonePe / UPI';
    return 'Cash';
  };

  // Add Manual Transaction
  const handleAddTransaction = async () => {
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid positive amount.');
      return;
    }

    const isLending = type === 'debt_given';
    const effectiveType: 'inflow' | 'outflow' = isLending ? 'outflow' : type;
    const finalCategory = isLending ? 'Debt' : category;
    const finalMemo = isLending
      ? (borrowerName.trim() ? `${borrowerName.trim()} - Lent (${txAccount})` : `Lent to Friend (${txAccount})`)
      : (memo || finalCategory);

    const payload = {
      type: effectiveType,
      amount: parsedAmount,
      tier1_category: finalCategory,
      tier2_memo: finalMemo,
      // behavioral_source omitted for enum compatibility
      project_id: selectedProjectId || null,
      date: transactionDate,
    };

    try {
      const { data, error } = await supabase.from('transactions').insert([payload]).select();
      const newTx: Transaction = (data && data[0]) ? data[0] : { id: Date.now().toString(), ...payload };
      const updatedList = [newTx, ...transactions];
      setTransactions(updatedList);
      await AsyncStorage.setItem('offline_tx', JSON.stringify(updatedList));

      // If tagged as Lending, also record in planned_movements as debt_given
      if (isLending) {
        const debtPayload = {
          type: 'debt_given' as const,
          title: borrowerName.trim() || 'Friend',
          amount: parsedAmount,
          due_date: transactionDate,
          is_recurring: false,
          status: 'pending' as const,
          reminder_days_before: 1,
        };
        const { data: dData } = await supabase.from('planned_movements').insert([debtPayload]).select();
        const newDebt = (dData && dData[0]) ? dData[0] : { id: Date.now().toString(), ...debtPayload };
        const updatedDebts = [newDebt, ...plannedItems];
        setPlannedItems(updatedDebts);
        await AsyncStorage.setItem('offline_planned', JSON.stringify(updatedDebts));
      }

      scheduleLocalNotification(
        'Transaction Saved',
        `${effectiveType === 'inflow' ? 'Received' : 'Spent'} ₹${parsedAmount.toLocaleString('en-IN')} (${finalMemo})`
      );

      Alert.alert('Success', 'Transaction logged successfully!');
      setAmount('');
      setMemo('');
      setBorrowerName('');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Saved locally.');
    }
  };

  // Settle Debt Action (Mark Repaid)
  const handleSettleDebt = async (debt: PlannedMovement) => {
    Alert.alert(
      'Confirm Settlement',
      `Mark repayment of ₹${debt.amount.toLocaleString('en-IN')} from "${debt.title}" as received & settled?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark as Paid & Log Inflow',
          onPress: async () => {
            try {
              // 1. Update status to 'paid' in planned_movements
              await supabase.from('planned_movements').update({ status: 'paid' }).eq('id', debt.id);
              const updatedPlanned = plannedItems.map((p) => (p.id === debt.id ? { ...p, status: 'paid' as const } : p));
              setPlannedItems(updatedPlanned);
              await AsyncStorage.setItem('offline_planned', JSON.stringify(updatedPlanned));

              // 2. Automatically log an Inflow transaction into transactions
              if (debt.type === 'debt_given') {
                const repaymentPayload = {
                  type: 'inflow' as const,
                  amount: debt.amount,
                  tier1_category: 'Debt Repayment Received',
                  tier2_memo: `${debt.title} - Repayment Received`,
                  // behavioral_source omitted
                  date: new Date().toISOString().split('T')[0],
                };
                const { data: txData } = await supabase.from('transactions').insert([repaymentPayload]).select();
                const newTx: Transaction = (txData && txData[0]) ? txData[0] : { id: Date.now().toString(), ...repaymentPayload };
                const updatedTxs = [newTx, ...transactions];
                setTransactions(updatedTxs);
                await AsyncStorage.setItem('offline_tx', JSON.stringify(updatedTxs));
              }

              scheduleLocalNotification('Debt Settled ✅', `Received repayment of ₹${debt.amount} from ${debt.title}`);
              Alert.alert('Settled', `Successfully logged repayment of ₹${debt.amount}!`);
            } catch (e: any) {
              Alert.alert('Error', e.message);
            }
          },
        },
      ]
    );
  };

  // Add Loan Form
  const handleAddLoan = async () => {
    const amt = parseFloat(loanAmount);
    if (isNaN(amt) || amt <= 0 || !loanPerson.trim()) {
      Alert.alert('Required', 'Please enter borrower name and a valid amount.');
      return;
    }

    const payload = {
      type: loanType,
      title: loanPerson.trim(),
      amount: amt,
      due_date: loanDueDate,
      is_recurring: false,
      status: 'pending' as const,
      reminder_days_before: 1,
    };

    try {
      const { data, error } = await supabase.from('planned_movements').insert([payload]).select();
      if (error) throw error;
      const newDebt = (data && data[0]) ? data[0] : { id: Date.now().toString(), ...payload };
      const updated = [newDebt, ...plannedItems];
      setPlannedItems(updated);
      await AsyncStorage.setItem('offline_planned', JSON.stringify(updated));

      // Also create corresponding transaction
      const txPayload = {
        type: loanType === 'debt_given' ? ('outflow' as const) : ('inflow' as const),
        amount: amt,
        tier1_category: loanType === 'debt_given' ? 'Debt' : 'Debt Taken',
        tier2_memo: `${loanPerson.trim()} - ${loanType === 'debt_given' ? 'Lent' : 'Borrowed'} (${loanAccount})`,
        // behavioral_source omitted
        date: loanDueDate,
      };
      const { data: txData } = await supabase.from('transactions').insert([txPayload]).select();
      const newTx = (txData && txData[0]) ? txData[0] : { id: Date.now().toString(), ...txPayload };
      setTransactions([newTx, ...transactions]);
      await AsyncStorage.setItem('offline_tx', JSON.stringify([newTx, ...transactions]));

      setLoanPerson('');
      setLoanAmount('');
      setLoanModalVisible(false);
      Alert.alert('Loan Logged', `Logged ₹${amt} with ${loanPerson}!`);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  // Scan SMS Feature
  const handleScanSMS = async () => {
    setScanningSms(true);
    try {
      const results = await fetchBankTransactionsFromSMS();
      setParsedSmsList(results);
      setSmsModalVisible(true);
      if (results.length === 0) {
        Alert.alert('No Bank SMS Found', 'No financial debit or credit SMS messages were detected.');
      }
    } catch (e: any) {
      Alert.alert('SMS Permission', e.message || 'Could not scan SMS inbox.');
    } finally {
      setScanningSms(false);
    }
  };

  const handleImportSmsTx = async (tx: ParsedSmsTransaction) => {
    const payload = {
      type: tx.type,
      amount: tx.amount,
      tier1_category: tx.category,
      tier2_memo: tx.details,
      date: tx.date,
      // behavioral_source omitted
    };

    try {
      const { data, error } = await supabase.from('transactions').insert([payload]).select();
      const newTx: Transaction = (data && data[0]) ? data[0] : { id: Date.now().toString(), ...payload };
      const updatedList = [newTx, ...transactions];
      setTransactions(updatedList);
      await AsyncStorage.setItem('offline_tx', JSON.stringify(updatedList));

      setParsedSmsList(parsedSmsList.filter((item) => item.id !== tx.id));
      scheduleLocalNotification(
        'SMS Transaction Logged 📲',
        `${tx.type === 'outflow' ? 'Expense' : 'Income'} of ₹${tx.amount.toLocaleString('en-IN')} logged for ${tx.details}`
      );
      Alert.alert('Imported', `Logged ₹${tx.amount} (${tx.details})`);
    } catch (e: any) {
      Alert.alert('Import Error', e.message);
    }
  };

  const handleImportAllSms = async () => {
    if (parsedSmsList.length === 0) return;
    try {
      const rowsToInsert = parsedSmsList.map((tx) => ({
        type: tx.type,
        amount: tx.amount,
        tier1_category: tx.category,
        tier2_memo: tx.details,
        date: tx.date,
        // behavioral_source omitted
      }));

      const { data, error } = await supabase.from('transactions').insert(rowsToInsert).select();
      if (error) throw error;

      const newTxs: Transaction[] = data || [];
      const updatedList = [...newTxs, ...transactions];
      setTransactions(updatedList);
      await AsyncStorage.setItem('offline_tx', JSON.stringify(updatedList));

      scheduleLocalNotification(
        'Batch SMS Import Completed ⚡',
        `Successfully logged all ${rowsToInsert.length} transactions!`
      );

      setParsedSmsList([]);
      setSmsModalVisible(false);
      Alert.alert('Imported All', `Successfully logged all ${rowsToInsert.length} bank transactions!`);
    } catch (e: any) {
      Alert.alert('Import Error', e.message);
    }
  };

  // Import PhonePe PDF Statement
  const handleImportPdf = async () => {
    try {
      const parsedTxs = await pickAndParsePdfStatement();
      if (parsedTxs.length === 0) {
        Alert.alert('Statement Parser', 'No transactions found or file picking was cancelled.');
        return;
      }

      const rowsToInsert = parsedTxs.map((t) => ({
        type: t.type,
        amount: t.amount,
        tier1_category: t.category,
        tier2_memo: t.details,
        date: t.date,
        // behavioral_source omitted
      }));

      const { data, error } = await supabase.from('transactions').insert(rowsToInsert).select();
      if (data) {
        setTransactions([...data, ...transactions]);
        Alert.alert('Import Success', `Successfully imported ${data.length} transactions from statement!`);
      }
    } catch (e: any) {
      Alert.alert('PDF Parser Error', e.message || 'Failed to read PDF file.');
    }
  };

  // Handle Custom Reminders
  const handleAddReminder = async () => {
    if (!remTitle.trim()) {
      Alert.alert('Required', 'Please provide a title for the reminder.');
      return;
    }

    const payload = {
      title: remTitle,
      body: remBody || 'Expense Tracker Alert',
      type: remType,
      reminder_time: remTime,
      reminder_date: remDate,
    };

    try {
      const { data, error } = await supabase.from('general_reminders').insert([payload]).select();
      if (error) throw error;

      if (data && data[0]) {
        const updated = [data[0], ...reminders];
        setReminders(updated);
        await AsyncStorage.setItem('offline_reminders', JSON.stringify(updated));
      }

      scheduleLocalNotification('Reminder Set', `${remTitle} (${remTime})`);
      setRemTitle('');
      setRemBody('');
      Alert.alert('Reminder Set', 'Custom reminder saved successfully!');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const handleDeleteReminder = async (id: string) => {
    try {
      await supabase.from('general_reminders').delete().eq('id', id);
      const updated = reminders.filter((r) => r.id !== id);
      setReminders(updated);
      await AsyncStorage.setItem('offline_reminders', JSON.stringify(updated));
    } catch (e) {}
  };

  // Filtered Transactions by Account & Date
  const filteredTransactions = useMemo(() => {
    let list = transactions;

    if (selectedAccount !== 'All') {
      list = list.filter((t) => getAccountForTx(t) === selectedAccount);
    }

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    if (statsFilter === 'today') {
      list = list.filter((t) => (t.date || '').startsWith(todayStr));
    } else if (statsFilter === 'week') {
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      list = list.filter((t) => (t.date || '') >= oneWeekAgo);
    } else if (statsFilter === 'month') {
      const monthPrefix = todayStr.substring(0, 7);
      list = list.filter((t) => (t.date || '').startsWith(monthPrefix));
    }

    return list;
  }, [transactions, selectedAccount, statsFilter]);


  // Overall Account Calculations (Liquid Cash)
  const allAccountTransactions = useMemo(() => {
    if (selectedAccount === 'All') return transactions;
    return transactions.filter((t) => getAccountForTx(t) === selectedAccount);
  }, [transactions, selectedAccount]);

  const totalInflowAll = allAccountTransactions.filter((t) => t.type === 'inflow').reduce((s, t) => s + t.amount, 0);
  const totalOutflowAll = allAccountTransactions.filter((t) => t.type === 'outflow').reduce((s, t) => s + t.amount, 0);
  const liquidBalance = totalInflowAll - totalOutflowAll;

  // Lending & Debt calculations (Receivables are 100% your money!)
  const totalLentReceivable = useMemo(() => {
    return plannedItems
      .filter((p) => p.type === 'debt_given' && p.status === 'pending')
      .reduce((s, p) => s + p.amount, 0);
  }, [plannedItems]);

  const totalBorrowedPayable = useMemo(() => {
    return plannedItems
      .filter((p) => p.type === 'debt_taken' && p.status === 'pending')
      .reduce((s, p) => s + p.amount, 0);
  }, [plannedItems]);

  const totalNetWorth = liquidBalance + totalLentReceivable - totalBorrowedPayable;

  // Period-Filtered Transactions for Stats Tab
  const periodTransactions = useMemo(() => {
    let list = allAccountTransactions;
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    if (statsFilter === 'today') {
      list = list.filter((t) => (t.date || '').startsWith(todayStr));
    } else if (statsFilter === 'week') {
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      list = list.filter((t) => (t.date || '') >= oneWeekAgo);
    } else if (statsFilter === 'month') {
      const monthPrefix = todayStr.substring(0, 7);
      list = list.filter((t) => (t.date || '').startsWith(monthPrefix));
    }
    return list;
  }, [allAccountTransactions, statsFilter]);

  const periodRevenue = periodTransactions.filter((t) => t.type === 'inflow').reduce((acc, t) => acc + t.amount, 0);
  const periodExpenses = periodTransactions.filter((t) => t.type === 'outflow').reduce((acc, t) => acc + t.amount, 0);
  const periodNet = periodRevenue - periodExpenses;

  // Category Breakdown for the active period
  const categoryBreakdown = useMemo(() => {
    const outflows = periodTransactions.filter((t) => t.type === 'outflow');
    const totalOutflow = outflows.reduce((s, t) => s + t.amount, 0);
    const map = new Map<string, { category: string; amount: number; count: number }>();

    for (const t of outflows) {
      const cat = t.tier1_category || 'General Expense';
      const cur = map.get(cat) || { category: cat, amount: 0, count: 0 };
      cur.amount += t.amount;
      cur.count += 1;
      map.set(cat, cur);
    }

    const monochromePalette = isDark
      ? ['#FFFFFF', '#E4E4E7', '#A1A1AA', '#71717A', '#52525B', '#3F3F46', '#27272A']
      : ['#09090B', '#27272A', '#52525B', '#71717A', '#A1A1AA', '#D4D4D8', '#E4E4E7'];

    return Array.from(map.values())
      .sort((a, b) => b.amount - a.amount)
      .map((item, idx) => ({
        ...item,
        percentage: totalOutflow > 0 ? (item.amount / totalOutflow) * 100 : 0,
        color: monochromePalette[idx % monochromePalette.length],
      }));
  }, [periodTransactions, isDark]);

  const grossRevenue = totalInflowAll;
  const grossExpenses = totalOutflowAll;
  const netProfit = liquidBalance;
  const budgetUsagePercent = budget > 0 ? (periodExpenses / budget) * 100 : 0;

  // Day-by-Day P&L Grouping for Cards
  const dailyGroups = useMemo(() => {
    const map = new Map<string, { date: string; inflow: number; outflow: number; net: number; items: Transaction[] }>();

    for (const t of filteredTransactions) {
      const d = (t.date || '').substring(0, 10) || 'Unknown';
      let g = map.get(d);
      if (!g) {
        g = { date: d, inflow: 0, outflow: 0, net: 0, items: [] };
        map.set(d, g);
      }
      if (t.type === 'inflow') g.inflow += t.amount;
      else g.outflow += t.amount;
      g.net = g.inflow - g.outflow;
      g.items.push(t);
    }

    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredTransactions]);

  // Calendar View Days Calculation
  const calendarDays = useMemo(() => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startOffset = (firstDay + 6) % 7; // Monday start

    const days: { day: number; dateStr: string; net: number; hasTx: boolean; isCurrentMonth: boolean }[] = [];

    for (let i = 0; i < startOffset; i++) {
      days.push({ day: 0, dateStr: '', net: 0, hasTx: false, isCurrentMonth: false });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const mStr = (month + 1).toString().padStart(2, '0');
      const dStr = d.toString().padStart(2, '0');
      const dateStr = `${year}-${mStr}-${dStr}`;

      const txsOnDay = transactions.filter((t) => (t.date || '').startsWith(dateStr));
      const inflow = txsOnDay.filter((t) => t.type === 'inflow').reduce((s, t) => s + t.amount, 0);
      const outflow = txsOnDay.filter((t) => t.type === 'outflow').reduce((s, t) => s + t.amount, 0);
      const net = inflow - outflow;

      days.push({
        day: d,
        dateStr,
        net,
        hasTx: txsOnDay.length > 0,
        isCurrentMonth: true,
      });
    }

    return days;
  }, [calendarDate, transactions]);

  // Selected Calendar Date Transactions
  const selectedCalTxs = useMemo(() => {
    return transactions.filter((t) => (t.date || '').startsWith(selectedCalDate));
  }, [selectedCalDate, transactions]);

  const selectedCalInflow = selectedCalTxs.filter((t) => t.type === 'inflow').reduce((s, t) => s + t.amount, 0);
  const selectedCalOutflow = selectedCalTxs.filter((t) => t.type === 'outflow').reduce((s, t) => s + t.amount, 0);
  const selectedCalNet = selectedCalInflow - selectedCalOutflow;

  // Lending Computations
  const lentDebts = useMemo(() => plannedItems.filter((p) => p.type === 'debt_given'), [plannedItems]);
  const borrowedDebts = useMemo(() => plannedItems.filter((p) => p.type === 'debt_taken'), [plannedItems]);
  const totalLentPending = useMemo(() => lentDebts.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amount, 0), [lentDebts]);
  const totalBorrowedPending = useMemo(() => borrowedDebts.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amount, 0), [borrowedDebts]);

  const displayedLoans = useMemo(() => {
    const list = [...lentDebts, ...borrowedDebts];
    if (lendingFilter === 'pending') return list.filter((l) => l.status === 'pending');
    if (lendingFilter === 'settled') return list.filter((l) => l.status === 'paid');
    return list;
  }, [lentDebts, borrowedDebts, lendingFilter]);

  // Accounts Balances Computation
  const accountsSummary = useMemo(() => {
    const map: Record<string, { inflow: number; outflow: number; net: number; count: number }> = {
      'Canara Bank': { inflow: 0, outflow: 0, net: 0, count: 0 },
      'PhonePe / UPI': { inflow: 0, outflow: 0, net: 0, count: 0 },
      'HDFC Bank': { inflow: 0, outflow: 0, net: 0, count: 0 },
      'Cash': { inflow: 0, outflow: 0, net: 0, count: 0 },
    };

    for (const t of transactions) {
      const acc = getAccountForTx(t);
      if (!map[acc]) {
        map[acc] = { inflow: 0, outflow: 0, net: 0, count: 0 };
      }
      if (t.type === 'inflow') map[acc].inflow += t.amount;
      else map[acc].outflow += t.amount;
      map[acc].net = map[acc].inflow - map[acc].outflow;
      map[acc].count++;
    }

    return map;
  }, [transactions]);

  // Quick Amount Helper
  const quickAmounts = [50, 100, 200, 500, 1000, 2000];
  const handleQuickAdd = (val: number) => {
    const cur = parseFloat(amount) || 0;
    setAmount((cur + val).toString());
  };

  // Category Icon Helper
  const renderCategoryIcon = (catName: string, size = 18) => {
    const iconColor = theme.avatarIcon;
    const lower = (catName || '').toLowerCase();
    if (lower.includes('food') || lower.includes('dining') || lower.includes('restaurant') || lower.includes('swiggy') || lower.includes('zomato')) {
      return <Coffee size={size} color={iconColor} />;
    }
    if (lower.includes('transport') || lower.includes('travel') || lower.includes('uber') || lower.includes('ola') || lower.includes('petrol') || lower.includes('fuel')) {
      return <Car size={size} color={iconColor} />;
    }
    if (lower.includes('shopping') || lower.includes('amazon') || lower.includes('flipkart') || lower.includes('store') || lower.includes('mall')) {
      return <ShoppingBag size={size} color={iconColor} />;
    }
    if (lower.includes('bill') || lower.includes('utilities') || lower.includes('recharge') || lower.includes('electricity') || lower.includes('wifi')) {
      return <Zap size={size} color={iconColor} />;
    }
    if (lower.includes('debt') || lower.includes('lent')) {
      return <ArrowLeftRight size={size} color={iconColor} />;
    }
    return <CreditCard size={size} color={iconColor} />;
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={theme.statusBar as any} backgroundColor={theme.statusBarBg} />

      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerBrand}>
          <Text style={styles.brandTitle}>EXPENSE</Text>
          <View style={styles.statusPill}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>LIVE</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity style={styles.iconCircleBtn} onPress={fetchInitialData}>
            <RefreshCw color={theme.textPrimary} size={16} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Account Selector Horizontal Pills */}
      <View style={styles.accountsBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 6 }}>
          {ACCOUNTS.map((acc) => (
            <TouchableOpacity
              key={acc}
              style={[styles.accountPill, selectedAccount === acc && styles.accountPillActive]}
              onPress={() => setSelectedAccount(acc)}
            >
              <Text style={[styles.accountPillText, selectedAccount === acc && styles.accountPillTextActive]}>
                {acc}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.textPrimary} />
          <Text style={styles.loadingText}>Syncing with Supabase...</Text>
        </View>
      ) : (
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* TAB 1: DASHBOARD OVERVIEW */}
          {activeTab === 'dashboard' && (
            <View style={styles.tabContent}>
              {/* Hero Net Worth Card (Apple Wallet / Linear style) */}
              <View style={styles.heroCard}>
                <View style={styles.heroTopRow}>
                  <Text style={styles.heroLabel}>
                    {selectedAccount === 'All' ? 'TOTAL NET WORTH' : `${selectedAccount.toUpperCase()} BALANCE`}
                  </Text>
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>FINTECH</Text>
                  </View>
                </View>
                <Text style={styles.heroBalance}>₹{totalNetWorth.toLocaleString('en-IN')}</Text>
                <Text style={[styles.subtext, { marginBottom: 14 }]}>
                  Liquid Accounts + Lent Money (₹{totalLentReceivable.toLocaleString('en-IN')})
                </Text>

                {/* Inflow / Outflow Pills */}
                <View style={styles.statsPillRow}>
                  <View style={styles.inflowPill}>
                    <ArrowDownLeft color={theme.inflowText} size={15} />
                    <View>
                      <Text style={styles.pillSub}>INFLOW</Text>
                      <Text style={styles.inflowVal}>+₹{grossRevenue.toLocaleString('en-IN')}</Text>
                    </View>
                  </View>

                  <View style={styles.outflowPill}>
                    <ArrowUpRight color={theme.outflowText} size={15} />
                    <View>
                      <Text style={styles.pillSub}>OUTFLOW</Text>
                      <Text style={styles.outflowVal}>-₹{grossExpenses.toLocaleString('en-IN')}</Text>
                    </View>
                  </View>
                </View>

                {/* 3 Wealth Pillars */}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  <View style={[styles.miniWealthCard, { backgroundColor: theme.surfaceElevated }]}>
                    <Text style={[styles.miniWealthLabel, { color: theme.textTertiary }]}>IN ACCOUNTS</Text>
                    <Text style={[styles.miniWealthVal, { color: theme.textPrimary }]}>₹{liquidBalance.toLocaleString('en-IN')}</Text>
                  </View>
                  <View style={[styles.miniWealthCard, { backgroundColor: theme.surfaceElevated }]}>
                    <Text style={[styles.miniWealthLabel, { color: theme.textTertiary }]}>LENT (YOUR ASSET)</Text>
                    <Text style={[styles.miniWealthVal, { color: theme.textPrimary }]}>₹{totalLentReceivable.toLocaleString('en-IN')}</Text>
                  </View>
                  <View style={[styles.miniWealthCard, { backgroundColor: theme.surfaceElevated }]}>
                    <Text style={[styles.miniWealthLabel, { color: theme.textTertiary }]}>YOU OWE</Text>
                    <Text style={[styles.miniWealthVal, { color: theme.textPrimary }]}>₹{totalBorrowedPayable.toLocaleString('en-IN')}</Text>
                  </View>
                </View>
              </View>

              {/* CATEGORY LEVEL MONEY USAGE SECTION */}
              <View style={styles.card}>
                <View style={styles.rowBetween}>
                  <View>
                    <Text style={styles.cardSectionLabel}>SPENDING BREAKDOWN</Text>
                    <Text style={[styles.subtext, { marginTop: 2 }]}>Category-level distribution</Text>
                  </View>
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{categoryBreakdown.length} categories</Text>
                  </View>
                </View>

                {periodExpenses > 0 ? (
                  <>
                    <CategoryDonutChart data={categoryBreakdown} total={periodExpenses} theme={theme} />

                    {/* Interactive Horizontal Progress Bars */}
                    <View style={{ gap: 10, marginTop: 8 }}>
                      {categoryBreakdown.map((cat) => {
                        const isExpanded = expandedCategory === cat.category;
                        return (
                          <View key={cat.category} style={[styles.catCard, { backgroundColor: theme.surfaceElevated }]}>
                            <TouchableOpacity
                              style={styles.catCardHeader}
                              onPress={() => setExpandedCategory(isExpanded ? null : cat.category)}
                              activeOpacity={0.7}
                            >
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                                <View style={[styles.catIconWrap, { backgroundColor: theme.borderStrong }]}>
                                  {renderCategoryIcon(cat.category, 15)}
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={[styles.catName, { color: theme.textPrimary }]} numberOfLines={1}>{cat.category}</Text>
                                  <Text style={[styles.catSub, { color: theme.textTertiary }]}>{cat.count} txns</Text>
                                </View>
                              </View>
                              <View style={{ alignItems: 'flex-end' }}>
                                <Text style={[styles.catAmount, { color: theme.textPrimary }]}>₹{cat.amount.toLocaleString('en-IN')}</Text>
                                <Text style={[styles.catPercent, { color: theme.textSecondary }]}>{cat.percentage.toFixed(1)}%</Text>
                              </View>
                            </TouchableOpacity>

                            {/* Progress Bar Track */}
                            <View style={[styles.catProgressTrack, { backgroundColor: theme.borderStrong }]}>
                              <View
                                style={[
                                  styles.catProgressBar,
                                  { width: `${Math.min(cat.percentage, 100)}%`, backgroundColor: cat.color },
                                ]}
                              />
                            </View>

                            {/* Expanded Transaction List */}
                            {isExpanded && (
                              <View style={styles.catExpandedList}>
                                {periodTransactions
                                  .filter((t) => t.type === 'outflow' && t.tier1_category === cat.category)
                                  .slice(0, 10)
                                  .map((t) => (
                                    <View key={t.id} style={styles.catTxRow}>
                                      <View style={{ flex: 1 }}>
                                        <Text style={[styles.catTxMemo, { color: theme.textPrimary }]} numberOfLines={1}>
                                          {t.tier2_memo || t.tier1_category}
                                        </Text>
                                        <Text style={[styles.catTxDate, { color: theme.textTertiary }]}>
                                          {t.date ? t.date.substring(0, 10) : ''} • {getAccountForTx(t)}
                                        </Text>
                                      </View>
                                      <Text style={[styles.catTxAmount, { color: theme.outflowText }]}>
                                        -₹{t.amount.toLocaleString('en-IN')}
                                      </Text>
                                    </View>
                                  ))}
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  </>
                ) : (
                  <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                    <Text style={styles.subtext}>No expense transactions in this period.</Text>
                  </View>
                )}
              </View>

              {/* Monthly Budget Card */}
              <View style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardSectionLabel}>MONTHLY BUDGET</Text>
                  <View style={styles.budgetBadge}>
                    <Text style={styles.budgetPercentText}>{Math.round(budgetUsagePercent)}%</Text>
                  </View>
                </View>

                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressBar,
                      { width: `${Math.min(budgetUsagePercent, 100)}%` },
                      budgetUsagePercent > 90 ? { backgroundColor: '#EF4444' } : { backgroundColor: theme.progressFill },
                    ]}
                  />
                </View>

                <View style={styles.rowBetween}>
                  <Text style={styles.subtext}>₹{grossExpenses.toLocaleString('en-IN')} spent</Text>
                  <Text style={styles.subtext}>₹{Math.max(budget - grossExpenses, 0).toLocaleString('en-IN')} remaining</Text>
                </View>
              </View>

              {/* Quick Action Grid */}
              <View style={styles.quickGrid}>
                <TouchableOpacity style={styles.actionCard} onPress={handleScanSMS}>
                  <View style={styles.actionIconCircle}>
                    <MessageSquare color={theme.avatarIcon} size={18} />
                  </View>
                  <View style={styles.actionMeta}>
                    <Text style={styles.actionTitle}>Scan Bank SMS</Text>
                    <Text style={styles.actionSubtitle}>Auto-sync UPI msgs</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity style={styles.actionCard} onPress={handleImportPdf}>
                  <View style={styles.actionIconCircle}>
                    <FileText color={theme.avatarIcon} size={18} />
                  </View>
                  <View style={styles.actionMeta}>
                    <Text style={styles.actionTitle}>PDF Statement</Text>
                    <Text style={styles.actionSubtitle}>Canara & PhonePe</Text>
                  </View>
                </TouchableOpacity>
              </View>

              {/* Recent Activity Feed */}
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>RECENT ACTIVITY</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{filteredTransactions.length} txns</Text>
                </View>
              </View>

              {filteredTransactions.slice(0, 20).map((t) => (
                <View key={t.id} style={styles.txItem}>
                  <View style={styles.txAvatar}>
                    {renderCategoryIcon(t.tier1_category)}
                  </View>
                  <View style={styles.txDetails}>
                    <Text style={styles.txMemo} numberOfLines={1}>{t.tier2_memo || t.tier1_category}</Text>
                    <Text style={styles.txSub}>{t.tier1_category} • {t.date} • {getAccountForTx(t)}</Text>
                  </View>
                  <Text style={t.type === 'inflow' ? styles.txAmountPositive : styles.txAmountNegative}>
                    {t.type === 'inflow' ? '+' : '-'}₹{t.amount.toLocaleString('en-IN')}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* TAB 2: STATISTICS, DAILY P&L CARDS & CALENDAR */}
          {activeTab === 'stats' && (
            <View style={styles.tabContent}>
              {/* Date Filter & View Switcher */}
              <View style={styles.segmentedContainer}>
                {(['today', 'week', 'month', 'all'] as const).map((f) => (
                  <TouchableOpacity
                    key={f}
                    style={[styles.segmentBtn, statsFilter === f && styles.segmentActive]}
                    onPress={() => setStatsFilter(f)}
                  >
                    <Text style={[styles.segmentText, statsFilter === f && styles.segmentTextActive]}>
                      {f.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* View Switcher: Daily Cards vs Calendar */}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={[styles.modeToggleBtn, statsViewMode === 'cards' && styles.modeToggleActive]}
                  onPress={() => setStatsViewMode('cards')}
                >
                  <BarChart3 size={15} color={statsViewMode === 'cards' ? theme.buttonPrimaryText : theme.textTertiary} />
                  <Text style={[styles.modeToggleText, statsViewMode === 'cards' && styles.modeToggleTextActive]}>
                    Daily Cards ({dailyGroups.length} days)
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modeToggleBtn, statsViewMode === 'calendar' && styles.modeToggleActive]}
                  onPress={() => setStatsViewMode('calendar')}
                >
                  <Calendar size={15} color={statsViewMode === 'calendar' ? theme.buttonPrimaryText : theme.textTertiary} />
                  <Text style={[styles.modeToggleText, statsViewMode === 'calendar' && styles.modeToggleTextActive]}>
                    Calendar View
                  </Text>
                </TouchableOpacity>
              </View>

              {/* SUMMARY STATS BAR */}
              <View style={styles.statsSummaryCard}>
                <View style={styles.statCol}>
                  <Text style={styles.statLabelMuted}>PERIOD PROFIT / LOSS</Text>
                  <Text style={[styles.statValueBig, { color: periodNet >= 0 ? theme.inflowText : theme.outflowText }]}>
                    {periodNet >= 0 ? '+' : '-'}₹{Math.abs(periodNet).toLocaleString('en-IN')}
                  </Text>
                </View>

                <View style={styles.statDividerVertical} />

                <View style={styles.statCol}>
                  <Text style={styles.statLabelMuted}>INFLOW / OUTFLOW</Text>
                  <Text style={[styles.statValueMid, { color: theme.inflowText }]}>+₹{periodRevenue.toLocaleString('en-IN')}</Text>
                  <Text style={[styles.statValueMid, { color: theme.outflowText, marginTop: 4 }]}>-₹{periodExpenses.toLocaleString('en-IN')}</Text>
                </View>
              </View>

              {/* PERIOD CATEGORY USAGE BREAKDOWN */}
              {periodExpenses > 0 && (
                <View style={styles.card}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.cardSectionLabel}>PERIOD SPENDING BY CATEGORY</Text>
                    <View style={styles.countBadge}>
                      <Text style={styles.countBadgeText}>{categoryBreakdown.length} categories</Text>
                    </View>
                  </View>

                  <View style={{ gap: 8, marginTop: 10 }}>
                    {categoryBreakdown.map((cat) => (
                      <View key={cat.category} style={[styles.catCard, { backgroundColor: theme.surfaceElevated, padding: 10 }]}>
                        <View style={styles.catCardHeader}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <View style={[styles.catIconWrap, { width: 26, height: 26, borderRadius: 13, backgroundColor: theme.borderStrong }]}>
                              {renderCategoryIcon(cat.category, 13)}
                            </View>
                            <Text style={[styles.catName, { color: theme.textPrimary, fontSize: 12 }]}>{cat.category}</Text>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={[styles.catAmount, { color: theme.textPrimary, fontSize: 12 }]}>₹{cat.amount.toLocaleString('en-IN')}</Text>
                            <Text style={[styles.catPercent, { color: theme.textSecondary, fontSize: 10 }]}>{cat.percentage.toFixed(1)}%</Text>
                          </View>
                        </View>
                        <View style={[styles.catProgressTrack, { backgroundColor: theme.borderStrong, height: 3, marginTop: 6 }]}>
                          <View style={[styles.catProgressBar, { width: `${Math.min(cat.percentage, 100)}%`, backgroundColor: cat.color, height: 3 }]} />
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* VIEW 1: DAILY PROFIT & LOSS CARDS */}
              {statsViewMode === 'cards' && (
                <View style={{ gap: 12 }}>
                  <Text style={styles.sectionHeading}>DAY-BY-DAY PROFIT &amp; LOSS</Text>
                  {dailyGroups.length === 0 ? (
                    <View style={styles.emptyCard}>
                      <Text style={styles.emptyText}>No transactions found for the selected period.</Text>
                    </View>
                  ) : (
                    dailyGroups.map((group) => (
                      <View key={group.date} style={styles.dayCard}>
                        {/* Day Card Header */}
                        <View style={styles.dayCardHeader}>
                          <View>
                            <Text style={styles.dayCardDate}>{group.date}</Text>
                            <Text style={styles.dayCardSub}>
                              +{group.inflow.toLocaleString()} in • -{group.outflow.toLocaleString()} out ({group.items.length} txns)
                            </Text>
                          </View>
                          <View style={[styles.netBadge, { backgroundColor: group.net >= 0 ? theme.inflowBg : theme.outflowBg, borderColor: group.net >= 0 ? theme.inflowBorder : theme.outflowBorder }]}>
                            <Text style={{ fontSize: 13, fontWeight: '800', color: group.net >= 0 ? theme.inflowText : theme.outflowText }}>
                              {group.net >= 0 ? '+' : '-'}₹{Math.abs(group.net).toLocaleString('en-IN')}
                            </Text>
                          </View>
                        </View>

                        {/* Transactions inside this Day Card */}
                        <View style={{ marginTop: 10, gap: 6 }}>
                          {group.items.map((it) => (
                            <View key={it.id} style={styles.dayTxRow}>
                              <View style={styles.dayTxLeft}>
                                {renderCategoryIcon(it.tier1_category, 14)}
                                <Text style={styles.dayTxMemo} numberOfLines={1}>{it.tier2_memo || it.tier1_category}</Text>
                              </View>
                              <Text style={it.type === 'inflow' ? styles.txAmountPositive : styles.txAmountNegative}>
                                {it.type === 'inflow' ? '+' : '-'}₹{it.amount.toLocaleString()}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    ))
                  )}
                </View>
              )}

              {/* VIEW 2: INTERACTIVE CALENDAR VIEW */}
              {statsViewMode === 'calendar' && (
                <View style={styles.calendarContainer}>
                  {/* Calendar Month Navigation Header */}
                  <View style={styles.calendarHeaderRow}>
                    <TouchableOpacity
                      onPress={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1))}
                      style={styles.calNavBtn}
                    >
                      <ChevronLeft color={theme.textPrimary} size={20} />
                    </TouchableOpacity>

                    <Text style={styles.calendarMonthTitle}>
                      {calendarDate.toLocaleString('default', { month: 'long', year: 'numeric' }).toUpperCase()}
                    </Text>

                    <TouchableOpacity
                      onPress={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1))}
                      style={styles.calNavBtn}
                    >
                      <ChevronRight color={theme.textPrimary} size={20} />
                    </TouchableOpacity>
                  </View>

                  {/* Day of Week Labels */}
                  <View style={styles.calendarWeekRow}>
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((dayName, idx) => (
                      <Text key={idx} style={styles.calWeekText}>{dayName}</Text>
                    ))}
                  </View>

                  {/* Calendar Grid */}
                  <View style={styles.calendarGrid}>
                    {calendarDays.map((cd, index) => {
                      if (!cd.isCurrentMonth) {
                        return <View key={index} style={styles.calCellEmpty} />;
                      }
                      const isSelected = selectedCalDate === cd.dateStr;
                      return (
                        <TouchableOpacity
                          key={index}
                          style={[styles.calCell, isSelected && styles.calCellSelected]}
                          onPress={() => setSelectedCalDate(cd.dateStr)}
                        >
                          <Text style={[styles.calCellText, isSelected && styles.calCellTextSelected]}>
                            {cd.day}
                          </Text>
                          {cd.hasTx && (
                            <View style={[styles.calDot, { backgroundColor: cd.net >= 0 ? theme.inflowText : theme.outflowText }]} />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Selected Day Inspector Card */}
                  <View style={styles.selectedDayCard}>
                    <View style={styles.rowBetween}>
                      <View>
                        <Text style={styles.dayCardDate}>{selectedCalDate}</Text>
                        <Text style={styles.dayCardSub}>{selectedCalTxs.length} transactions on this day</Text>
                      </View>
                      <View style={[styles.netBadge, { backgroundColor: selectedCalNet >= 0 ? theme.inflowBg : theme.outflowBg, borderColor: selectedCalNet >= 0 ? theme.inflowBorder : theme.outflowBorder }]}>
                        <Text style={{ fontSize: 14, fontWeight: '800', color: selectedCalNet >= 0 ? theme.inflowText : theme.outflowText }}>
                          {selectedCalNet >= 0 ? '+' : '-'}₹{Math.abs(selectedCalNet).toLocaleString('en-IN')}
                        </Text>
                      </View>
                    </View>

                    {selectedCalTxs.length === 0 ? (
                      <Text style={[styles.emptyText, { marginTop: 10 }]}>No transactions logged on this day.</Text>
                    ) : (
                      <View style={{ marginTop: 12, gap: 6 }}>
                        {selectedCalTxs.map((t) => (
                          <View key={t.id} style={styles.dayTxRow}>
                            <View style={styles.dayTxLeft}>
                              {renderCategoryIcon(t.tier1_category, 14)}
                              <Text style={styles.dayTxMemo} numberOfLines={1}>{t.tier2_memo || t.tier1_category}</Text>
                            </View>
                            <Text style={t.type === 'inflow' ? styles.txAmountPositive : styles.txAmountNegative}>
                              {t.type === 'inflow' ? '+' : '-'}₹{t.amount.toLocaleString()}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* TAB 3: ADD TRANSACTION / LEND FORM */}
          {activeTab === 'input' && (
            <View style={styles.tabContent}>
              <View style={styles.card}>
                {/* Type Segment Control: Expense vs Income vs Lent */}
                <View style={styles.segmentedContainer}>
                  <TouchableOpacity
                    style={[styles.segmentBtn, type === 'outflow' && styles.segmentActive]}
                    onPress={() => setType('outflow')}
                  >
                    <Text style={[styles.segmentText, type === 'outflow' && styles.segmentTextActive]}>Expense</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.segmentBtn, type === 'inflow' && styles.segmentActive]}
                    onPress={() => setType('inflow')}
                  >
                    <Text style={[styles.segmentText, type === 'inflow' && styles.segmentTextActive]}>Income</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.segmentBtn, type === 'debt_given' && styles.segmentActive]}
                    onPress={() => setType('debt_given')}
                  >
                    <Text style={[styles.segmentText, type === 'debt_given' && styles.segmentTextActive]}>🤝 Lent</Text>
                  </TouchableOpacity>
                </View>

                {/* Hero Amount Input */}
                <View style={styles.heroAmountBox}>
                  <Text style={styles.heroCurrency}>₹</Text>
                  <TextInput
                    style={styles.heroAmountInput}
                    placeholder="0"
                    placeholderTextColor={theme.textHint}
                    keyboardType="numeric"
                    value={amount}
                    onChangeText={setAmount}
                  />
                </View>

                {/* Quick Increment Pills */}
                <View style={styles.quickAmountRow}>
                  {quickAmounts.map((q) => (
                    <TouchableOpacity key={q} style={styles.quickPill} onPress={() => handleQuickAdd(q)}>
                      <Text style={styles.quickPillText}>+{q >= 1000 ? `${q / 1000}k` : q}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={styles.clearPill} onPress={() => setAmount('')}>
                    <Text style={styles.clearPillText}>CLEAR</Text>
                  </TouchableOpacity>
                </View>

                {/* Account Picker */}
                <Text style={styles.fieldSectionLabel}>ACCOUNT</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                  {ACCOUNTS.filter((a) => a !== 'All').map((acc) => (
                    <TouchableOpacity
                      key={acc}
                      style={[styles.chipPill, txAccount === acc && styles.chipPillActive]}
                      onPress={() => setTxAccount(acc)}
                    >
                      <Text style={[styles.chipPillText, txAccount === acc && styles.chipPillTextActive]}>{acc}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* If type is Lending: Borrower Name input */}
                {type === 'debt_given' && (
                  <>
                    <Text style={styles.fieldSectionLabel}>WHO BORROWED FROM YOU? (NAME)</Text>
                    <TextInput
                      style={styles.textInputSurface}
                      placeholder="e.g. Kamal, Sazad, Rahul"
                      placeholderTextColor={theme.textHint}
                      value={borrowerName}
                      onChangeText={setBorrowerName}
                    />
                  </>
                )}

                {/* Category Selector (Hidden if Lent) */}
                {type !== 'debt_given' && (
                  <>
                    <Text style={styles.fieldSectionLabel}>CATEGORY</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow}>
                      {[
                        'Food & Dining',
                        'Transportation',
                        'Shopping',
                        'Bills & Utilities',
                        'Entertainment',
                        'Health & Medical',
                        'General Expense',
                      ].map((cat) => (
                        <TouchableOpacity
                          key={cat}
                          style={[styles.chipPill, category === cat && styles.chipPillActive]}
                          onPress={() => setCategory(cat)}
                        >
                          <Text style={[styles.chipPillText, category === cat && styles.chipPillTextActive]}>{cat}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </>
                )}

                {/* Note / Memo */}
                <Text style={styles.fieldSectionLabel}>NOTE / DETAILS</Text>
                <TextInput
                  style={styles.textInputSurface}
                  placeholder={type === 'debt_given' ? 'Reason / Settlement condition' : 'e.g. Swiggy, Petrol, Chai'}
                  placeholderTextColor={theme.textHint}
                  value={memo}
                  onChangeText={setMemo}
                />

                {/* Save Button */}
                <TouchableOpacity style={styles.heroSubmitBtn} onPress={handleAddTransaction}>
                  <Text style={styles.heroSubmitBtnText}>
                    {type === 'debt_given' ? '🤝 Log Lent Money' : 'Save Transaction'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* TAB 4: LENDING & DEBTS HUB */}
          {activeTab === 'lending' && (
            <View style={styles.tabContent}>
              {/* Lending Metrics Row */}
              <View style={styles.heroCard}>
                <View style={styles.rowBetween}>
                  <Text style={styles.heroLabel}>LENDING &amp; DEBT SUMMARY</Text>
                  <TouchableOpacity style={styles.addLoanIconBtn} onPress={() => setLoanModalVisible(true)}>
                    <UserPlus size={16} color={theme.buttonPrimaryText} />
                    <Text style={{ color: theme.buttonPrimaryText, fontWeight: '700', fontSize: 12 }}>+ New Loan</Text>
                  </TouchableOpacity>
                </View>

                <View style={{ marginTop: 14, flexDirection: 'row', gap: 10 }}>
                  <View style={styles.inflowPill}>
                    <ArrowDownLeft color={theme.inflowText} size={15} />
                    <View>
                      <Text style={styles.pillSub}>OWED TO YOU (LENT)</Text>
                      <Text style={styles.inflowVal}>₹{totalLentPending.toLocaleString('en-IN')}</Text>
                    </View>
                  </View>

                  <View style={styles.outflowPill}>
                    <ArrowUpRight color={theme.outflowText} size={15} />
                    <View>
                      <Text style={styles.pillSub}>YOU OWE (BORROWED)</Text>
                      <Text style={styles.outflowVal}>₹{totalBorrowedPending.toLocaleString('en-IN')}</Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* Status Filter: Pending vs Settled vs All */}
              <View style={styles.segmentedContainer}>
                {(['pending', 'settled', 'all'] as const).map((st) => (
                  <TouchableOpacity
                    key={st}
                    style={[styles.segmentBtn, lendingFilter === st && styles.segmentActive]}
                    onPress={() => setLendingFilter(st)}
                  >
                    <Text style={[styles.segmentText, lendingFilter === st && styles.segmentTextActive]}>
                      {st.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* List of Loans & Borrowers */}
              <View style={{ gap: 10 }}>
                {displayedLoans.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Users size={32} color={theme.textTertiary} />
                    <Text style={styles.emptyText}>No {lendingFilter} loans found.</Text>
                    <TouchableOpacity style={[styles.heroSubmitBtn, { paddingHorizontal: 20, marginTop: 10 }]} onPress={() => setLoanModalVisible(true)}>
                      <Text style={styles.heroSubmitBtnText}>+ Log First Loan</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  displayedLoans.map((loan) => {
                    const isLent = loan.type === 'debt_given';
                    const isPending = loan.status === 'pending';
                    return (
                      <View key={loan.id} style={styles.loanCard}>
                        <View style={styles.rowBetween}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <View style={[styles.txAvatar, { backgroundColor: isLent ? theme.inflowBg : theme.outflowBg }]}>
                              <Users size={18} color={isLent ? theme.inflowText : theme.outflowText} />
                            </View>
                            <View>
                              <Text style={styles.txMemo}>{loan.title}</Text>
                              <Text style={styles.txSub}>
                                {isLent ? 'Lent to friend' : 'Borrowed'} • Due: {loan.due_date}
                              </Text>
                            </View>
                          </View>
                          <Text style={{ fontSize: 16, fontWeight: '800', color: isLent ? theme.inflowText : theme.outflowText }}>
                            ₹{loan.amount.toLocaleString()}
                          </Text>
                        </View>

                        <View style={styles.loanCardFooter}>
                          <View style={[styles.statusBadgeSmall, { backgroundColor: isPending ? theme.surfaceElevated : theme.inflowBg }]}>
                            <Text style={{ fontSize: 10, fontWeight: '800', color: isPending ? theme.textSecondary : theme.inflowText }}>
                              {loan.status.toUpperCase()}
                            </Text>
                          </View>

                          {isPending && (
                            <TouchableOpacity style={styles.settleBtn} onPress={() => handleSettleDebt(loan)}>
                              <CheckCircle2 size={14} color="#000000" />
                              <Text style={styles.settleBtnText}>Mark Repaid</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            </View>
          )}

          {/* TAB 5: ACCOUNTS & BALANCES */}
          {activeTab === 'accounts' && (
            <View style={styles.tabContent}>
              <Text style={styles.sectionHeading}>ACCOUNT BALANCES</Text>
              <View style={{ gap: 10 }}>
                {Object.entries(accountsSummary).map(([accName, accData]) => (
                  <TouchableOpacity
                    key={accName}
                    style={styles.accountCard}
                    onPress={() => {
                      setSelectedAccount(accName);
                      setActiveTab('dashboard');
                    }}
                  >
                    <View style={styles.rowBetween}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={styles.txAvatar}>
                          <CreditCard size={18} color={theme.avatarIcon} />
                        </View>
                        <View>
                          <Text style={styles.txMemo}>{accName}</Text>
                          <Text style={styles.txSub}>{accData.count} transactions logged</Text>
                        </View>
                      </View>
                      <Text style={[styles.statValueMid, { color: accData.net >= 0 ? theme.inflowText : theme.outflowText }]}>
                        {accData.net >= 0 ? '+' : '-'}₹{Math.abs(accData.net).toLocaleString('en-IN')}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.borderSubtle }}>
                      <Text style={styles.subtext}>Inflow: ₹{accData.inflow.toLocaleString()}</Text>
                      <Text style={styles.subtext}>Outflow: ₹{accData.outflow.toLocaleString()}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Subscriptions & Reminders Section */}
              <View style={[styles.sectionHeaderRow, { marginTop: 10 }]}>
                <Text style={styles.sectionHeading}>REMINDERS &amp; ALERTS</Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardSectionLabel}>NEW REMINDER</Text>
                <TextInput
                  style={styles.textInputSurface}
                  placeholder="Reminder Title (e.g. Pay Rent)"
                  placeholderTextColor={theme.textHint}
                  value={remTitle}
                  onChangeText={setRemTitle}
                />
                <TextInput
                  style={styles.textInputSurface}
                  placeholder="Details / Notes"
                  placeholderTextColor={theme.textHint}
                  value={remBody}
                  onChangeText={setRemBody}
                />
                <TouchableOpacity style={styles.heroSubmitBtn} onPress={handleAddReminder}>
                  <Text style={styles.heroSubmitBtnText}>Create Reminder</Text>
                </TouchableOpacity>
              </View>

              {reminders.map((r) => (
                <View key={r.id} style={styles.txItem}>
                  <View style={styles.txAvatar}>
                    <Clock color={theme.avatarIcon} size={18} />
                  </View>
                  <View style={styles.txDetails}>
                    <Text style={styles.txMemo}>{r.title}</Text>
                    <Text style={styles.txSub}>{r.type.toUpperCase()} • {r.reminder_time || '20:00'}</Text>
                  </View>
                  <TouchableOpacity onPress={() => handleDeleteReminder(r.id)} style={styles.trashBtn}>
                    <Trash2 color="#FB7185" size={17} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {/* DOCKED MODERN 5-TAB BOTTOM NAVIGATION BAR */}
      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.bottomBarItem} onPress={() => setActiveTab('dashboard')}>
          <Wallet color={activeTab === 'dashboard' ? theme.textPrimary : theme.textTertiary} size={20} />
          <Text style={[styles.bottomBarText, activeTab === 'dashboard' && styles.bottomBarTextActive]}>
            Overview
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.bottomBarItem} onPress={() => setActiveTab('stats')}>
          <BarChart3 color={activeTab === 'stats' ? theme.textPrimary : theme.textTertiary} size={20} />
          <Text style={[styles.bottomBarText, activeTab === 'stats' && styles.bottomBarTextActive]}>
            Stats
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.bottomBarCenterBtn} onPress={() => setActiveTab('input')}>
          <View style={[styles.centerAddPill, activeTab === 'input' && styles.centerAddPillActive]}>
            <Plus color={activeTab === 'input' ? theme.buttonPrimaryText : theme.avatarIcon} size={22} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.bottomBarItem} onPress={() => setActiveTab('lending')}>
          <Users color={activeTab === 'lending' ? theme.textPrimary : theme.textTertiary} size={20} />
          <Text style={[styles.bottomBarText, activeTab === 'lending' && styles.bottomBarTextActive]}>
            Lending
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.bottomBarItem} onPress={() => setActiveTab('accounts')}>
          <CreditCard color={activeTab === 'accounts' ? theme.textPrimary : theme.textTertiary} size={20} />
          <Text style={[styles.bottomBarText, activeTab === 'accounts' && styles.bottomBarTextActive]}>
            Accounts
          </Text>
        </TouchableOpacity>
      </View>

      {/* NEW LOAN MODAL */}
      <Modal visible={loanModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>🤝 Log Loan / Lent Money</Text>

            <View style={[styles.segmentedContainer, { marginVertical: 12 }]}>
              <TouchableOpacity
                style={[styles.segmentBtn, loanType === 'debt_given' && styles.segmentActive]}
                onPress={() => setLoanType('debt_given')}
              >
                <Text style={[styles.segmentText, loanType === 'debt_given' && styles.segmentTextActive]}>Lent (They Owe Me)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segmentBtn, loanType === 'debt_taken' && styles.segmentActive]}
                onPress={() => setLoanType('debt_taken')}
              >
                <Text style={[styles.segmentText, loanType === 'debt_taken' && styles.segmentTextActive]}>Borrowed (I Owe)</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.textInputSurface}
              placeholder="Friend / Borrower Name"
              placeholderTextColor={theme.textHint}
              value={loanPerson}
              onChangeText={setLoanPerson}
            />

            <TextInput
              style={styles.textInputSurface}
              placeholder="Amount (₹)"
              placeholderTextColor={theme.textHint}
              keyboardType="numeric"
              value={loanAmount}
              onChangeText={setLoanAmount}
            />

            <Text style={styles.fieldSectionLabel}>ACCOUNT</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {ACCOUNTS.filter((a) => a !== 'All').map((acc) => (
                <TouchableOpacity
                  key={acc}
                  style={[styles.chipPill, loanAccount === acc && styles.chipPillActive]}
                  onPress={() => setLoanAccount(acc)}
                >
                  <Text style={[styles.chipPillText, loanAccount === acc && styles.chipPillTextActive]}>{acc}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity style={styles.heroSubmitBtn} onPress={handleAddLoan}>
              <Text style={styles.heroSubmitBtnText}>Save Loan Entry</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setLoanModalVisible(false)}>
              <Text style={styles.modalCloseBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* SMS MODAL */}
      <Modal visible={smsModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <View style={styles.rowBetween}>
              <Text style={styles.modalTitle}>Detected SMS Transactions</Text>
              <Text style={styles.subtext}>{parsedSmsList.length} detected</Text>
            </View>

            {parsedSmsList.length > 0 && (
              <TouchableOpacity style={styles.modalActionBtn} onPress={handleImportAllSms}>
                <Text style={styles.modalActionBtnText}>Import All ({parsedSmsList.length} txns)</Text>
              </TouchableOpacity>
            )}

            <FlatList
              data={parsedSmsList}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 380, marginVertical: 8 }}
              renderItem={({ item }) => (
                <View style={styles.smsRow}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={styles.smsTitle}>{item.details}</Text>
                    <Text style={styles.smsMeta}>
                      ₹{item.amount.toLocaleString()} • {item.category} • {item.date}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.importBtn} onPress={() => handleImportSmsTx(item)}>
                    <CheckCircle color={theme.textPrimary} size={24} />
                  </TouchableOpacity>
                </View>
              )}
            />

            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setSmsModalVisible(false)}>
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 12,
      backgroundColor: theme.headerBg,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    headerBrand: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    brandTitle: {
      fontSize: 18,
      fontWeight: '900',
      letterSpacing: 2,
      color: theme.textPrimary,
    },
    statusPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: theme.surfaceSubtle,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.borderStrong,
    },
    statusDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: '#22C55E',
    },
    statusText: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.5,
      color: theme.textSecondary,
    },
    iconCircleBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: theme.surfaceSubtle,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      justifyContent: 'center',
      alignItems: 'center',
    },
    accountsBar: {
      backgroundColor: theme.headerBg,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: theme.borderSubtle,
    },
    accountPill: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 14,
      backgroundColor: theme.surfaceSubtle,
      borderWidth: 1,
      borderColor: theme.borderSubtle,
    },
    accountPillActive: {
      backgroundColor: theme.buttonPrimaryBg,
      borderColor: theme.buttonPrimaryBg,
    },
    accountPillText: {
      color: theme.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    accountPillTextActive: {
      color: theme.buttonPrimaryText,
      fontWeight: '800',
    },
    content: {
      flex: 1,
      paddingHorizontal: 16,
    },
    tabContent: {
      paddingTop: 14,
      paddingBottom: 40,
      gap: 14,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    loadingText: {
      marginTop: 12,
      color: theme.textSecondary,
      fontSize: 13,
    },

    /* Hero Balance Card */
    heroCard: {
      backgroundColor: theme.surface,
      borderRadius: 22,
      padding: 20,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: theme.isDark ? 0 : 0.05,
      shadowRadius: 8,
      elevation: theme.isDark ? 0 : 2,
    },
    heroTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    heroLabel: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.5,
      color: theme.textTertiary,
    },
    heroBalance: {
      fontSize: 36,
      fontWeight: '800',
      color: theme.textPrimary,
      marginTop: 4,
      marginBottom: 14,
      letterSpacing: -0.5,
    },
    statsPillRow: {
      flexDirection: 'row',
      gap: 10,
    },
    inflowPill: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: theme.inflowBg,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.inflowBorder,
    },
    outflowPill: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: theme.outflowBg,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.outflowBorder,
    },
    pillSub: {
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 1,
      color: theme.textTertiary,
    },
    inflowVal: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.inflowText,
      marginTop: 1,
    },
    outflowVal: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.outflowText,
      marginTop: 1,
    },

    /* Standard Card */
    card: {
      backgroundColor: theme.surface,
      borderRadius: 20,
      padding: 18,
      borderWidth: 1,
      borderColor: theme.borderSubtle,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: theme.isDark ? 0 : 0.04,
      shadowRadius: 6,
      elevation: theme.isDark ? 0 : 1,
    },
    cardSectionLabel: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1.2,
      color: theme.textTertiary,
    },
    budgetBadge: {
      backgroundColor: theme.surfaceElevated,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 10,
    },
    budgetPercentText: {
      color: theme.textPrimary,
      fontSize: 12,
      fontWeight: '700',
    },
    progressTrack: {
      height: 7,
      backgroundColor: theme.progressTrack,
      borderRadius: 4,
      overflow: 'hidden',
      marginVertical: 12,
    },
    progressBar: {
      height: '100%',
      borderRadius: 4,
    },
    rowBetween: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    subtext: {
      color: theme.textTertiary,
      fontSize: 12,
    },

    /* Quick Actions Grid */
    quickGrid: {
      flexDirection: 'row',
      gap: 10,
    },
    actionCard: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.surface,
      padding: 14,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.borderSubtle,
      gap: 10,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: theme.isDark ? 0 : 0.04,
      shadowRadius: 4,
      elevation: theme.isDark ? 0 : 1,
    },
    actionIconCircle: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: theme.avatarBg,
      borderWidth: 1,
      borderColor: theme.avatarBorder,
      justifyContent: 'center',
      alignItems: 'center',
    },
    actionMeta: {
      flex: 1,
    },
    actionTitle: {
      color: theme.textPrimary,
      fontSize: 13,
      fontWeight: '700',
    },
    actionSubtitle: {
      color: theme.textTertiary,
      fontSize: 11,
      marginTop: 2,
    },

    /* Activity Feed */
    sectionHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 4,
    },
    sectionHeading: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1.5,
      color: theme.textTertiary,
    },
    countBadge: {
      backgroundColor: theme.surfaceSubtle,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 10,
    },
    countBadgeText: {
      color: theme.textTertiary,
      fontSize: 11,
      fontWeight: '600',
    },
    txItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.surface,
      padding: 14,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.borderSubtle,
    },
    txAvatar: {
      width: 40,
      height: 40,
      borderRadius: 14,
      backgroundColor: theme.avatarBg,
      borderWidth: 1,
      borderColor: theme.avatarBorder,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    txDetails: {
      flex: 1,
      paddingRight: 10,
    },
    txMemo: {
      color: theme.textPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    txSub: {
      color: theme.textTertiary,
      fontSize: 11,
      marginTop: 2,
    },
    txAmountPositive: {
      color: theme.inflowText,
      fontSize: 15,
      fontWeight: '700',
    },
    txAmountNegative: {
      color: theme.textPrimary,
      fontSize: 15,
      fontWeight: '700',
    },

    /* Mode Toggles */
    modeToggleBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: theme.surfaceSubtle,
      borderWidth: 1,
      borderColor: theme.borderSubtle,
    },
    modeToggleActive: {
      backgroundColor: theme.buttonPrimaryBg,
      borderColor: theme.buttonPrimaryBg,
    },
    modeToggleText: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.textTertiary,
    },
    modeToggleTextActive: {
      color: theme.buttonPrimaryText,
      fontWeight: '800',
    },
    statsSummaryCard: {
      flexDirection: 'row',
      backgroundColor: theme.surface,
      borderRadius: 18,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.borderSubtle,
      alignItems: 'center',
    },
    statCol: {
      flex: 1,
    },
    statDividerVertical: {
      width: 1,
      height: 45,
      backgroundColor: theme.borderSubtle,
      marginHorizontal: 14,
    },
    statLabelMuted: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1,
      color: theme.textTertiary,
    },
    statValueBig: {
      fontSize: 22,
      fontWeight: '800',
      marginTop: 4,
    },
    statValueMid: {
      fontSize: 14,
      fontWeight: '700',
    },

    /* Day Cards */
    dayCard: {
      backgroundColor: theme.surface,
      borderRadius: 18,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.borderSubtle,
    },
    dayCardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: theme.borderSubtle,
    },
    dayCardDate: {
      fontSize: 14,
      fontWeight: '800',
      color: theme.textPrimary,
    },
    dayCardSub: {
      fontSize: 11,
      color: theme.textTertiary,
      marginTop: 2,
    },
    netBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 10,
      borderWidth: 1,
    },
    dayTxRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 4,
    },
    dayTxLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
      paddingRight: 10,
    },
    dayTxMemo: {
      color: theme.textPrimary,
      fontSize: 13,
      fontWeight: '500',
    },

    /* Calendar View Styles */
    calendarContainer: {
      backgroundColor: theme.surface,
      borderRadius: 20,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.borderSubtle,
    },
    calendarHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 14,
    },
    calendarMonthTitle: {
      fontSize: 14,
      fontWeight: '800',
      letterSpacing: 1.2,
      color: theme.textPrimary,
    },
    calNavBtn: {
      padding: 6,
      borderRadius: 8,
      backgroundColor: theme.surfaceSubtle,
    },
    calendarWeekRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      marginBottom: 8,
    },
    calWeekText: {
      fontSize: 11,
      fontWeight: '800',
      color: theme.textTertiary,
      width: 38,
      textAlign: 'center',
    },
    calendarGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-around',
    },
    calCell: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 10,
      marginVertical: 2,
    },
    calCellSelected: {
      backgroundColor: theme.buttonPrimaryBg,
    },
    calCellEmpty: {
      width: 40,
      height: 40,
      marginVertical: 2,
    },
    calCellText: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.textPrimary,
    },
    calCellTextSelected: {
      color: theme.buttonPrimaryText,
      fontWeight: '800',
    },
    calDot: {
      width: 4,
      height: 4,
      borderRadius: 2,
      marginTop: 2,
    },
    selectedDayCard: {
      backgroundColor: theme.surfaceSubtle,
      borderRadius: 16,
      padding: 14,
      marginTop: 14,
      borderWidth: 1,
      borderColor: theme.borderSubtle,
    },

    /* Lending Tab Styles */
    addLoanIconBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: theme.buttonPrimaryBg,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 12,
    },
    loanCard: {
      backgroundColor: theme.surface,
      borderRadius: 18,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.borderSubtle,
    },
    loanCardFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 12,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: theme.borderSubtle,
    },
    statusBadgeSmall: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 8,
    },
    settleBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: '#22C55E',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 10,
    },
    settleBtnText: {
      color: '#000000',
      fontSize: 12,
      fontWeight: '800',
    },

    /* Accounts Tab Styles */
    accountCard: {
      backgroundColor: theme.surface,
      borderRadius: 18,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.borderSubtle,
    },

    /* Add Transaction Form */
    segmentedContainer: {
      flexDirection: 'row',
      backgroundColor: theme.surfaceSubtle,
      borderRadius: 14,
      padding: 4,
      marginBottom: 14,
    },
    segmentBtn: {
      flex: 1,
      paddingVertical: 9,
      borderRadius: 10,
      alignItems: 'center',
    },
    segmentActive: {
      backgroundColor: theme.buttonPrimaryBg,
    },
    segmentText: {
      color: theme.textTertiary,
      fontSize: 12,
      fontWeight: '600',
    },
    segmentTextActive: {
      color: theme.buttonPrimaryText,
      fontWeight: '800',
    },
    heroAmountBox: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      backgroundColor: theme.surfaceSubtle,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.borderSubtle,
      marginBottom: 10,
    },
    heroCurrency: {
      fontSize: 32,
      fontWeight: '800',
      color: theme.textPrimary,
      marginRight: 4,
    },
    heroAmountInput: {
      fontSize: 36,
      fontWeight: '900',
      color: theme.textPrimary,
      minWidth: 120,
      textAlign: 'center',
    },
    quickAmountRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginBottom: 14,
    },
    quickPill: {
      backgroundColor: theme.surfaceSubtle,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.borderSubtle,
    },
    quickPillText: {
      color: theme.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    clearPill: {
      backgroundColor: theme.borderStrong,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 12,
    },
    clearPillText: {
      color: theme.textPrimary,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    fieldSectionLabel: {
      color: theme.textTertiary,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1.2,
      marginTop: 4,
      marginBottom: 6,
    },
    chipsRow: {
      marginBottom: 12,
    },
    chipPill: {
      backgroundColor: theme.chipInactiveBg,
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.chipInactiveBorder,
      marginRight: 8,
    },
    chipPillActive: {
      backgroundColor: theme.chipActiveBg,
      borderColor: theme.chipActiveBg,
    },
    chipPillText: {
      color: theme.chipInactiveText,
      fontSize: 12,
      fontWeight: '600',
    },
    chipPillTextActive: {
      color: theme.chipActiveText,
      fontWeight: '800',
    },
    textInputSurface: {
      backgroundColor: theme.surfaceSubtle,
      color: theme.textPrimary,
      padding: 13,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.borderSubtle,
      fontSize: 14,
      marginBottom: 12,
    },
    heroSubmitBtn: {
      backgroundColor: theme.buttonPrimaryBg,
      paddingVertical: 14,
      borderRadius: 14,
      alignItems: 'center',
      marginTop: 4,
    },
    heroSubmitBtnText: {
      color: theme.buttonPrimaryText,
      fontWeight: '800',
      fontSize: 15,
      letterSpacing: 0.2,
    },

    /* Empty State */
    emptyCard: {
      backgroundColor: theme.surface,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.borderSubtle,
      padding: 26,
      alignItems: 'center',
      gap: 10,
    },
    emptyText: {
      color: theme.textTertiary,
      fontSize: 13,
    },
    trashBtn: {
      padding: 6,
    },

    /* Bottom Navigation Bar */
    bottomBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
      backgroundColor: theme.headerBg,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      paddingVertical: 6,
      paddingHorizontal: 8,
    },
    bottomBarItem: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 4,
      paddingHorizontal: 10,
      gap: 3,
    },
    bottomBarText: {
      color: theme.textTertiary,
      fontSize: 9,
      fontWeight: '600',
    },
    bottomBarTextActive: {
      color: theme.textPrimary,
      fontWeight: '800',
    },
    bottomBarCenterBtn: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    centerAddPill: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: theme.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      justifyContent: 'center',
      alignItems: 'center',
    },
    centerAddPillActive: {
      backgroundColor: theme.buttonPrimaryBg,
      borderColor: theme.buttonPrimaryBg,
    },

    /* Modals */
    modalOverlay: {
      flex: 1,
      backgroundColor: theme.modalOverlay,
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      borderWidth: 1,
      borderColor: theme.borderSubtle,
      padding: 20,
    },
    modalHandle: {
      width: 36,
      height: 4,
      backgroundColor: theme.modalHandle,
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: 16,
    },
    modalTitle: {
      color: theme.textPrimary,
      fontSize: 16,
      fontWeight: '800',
    },
    modalActionBtn: {
      backgroundColor: theme.buttonPrimaryBg,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: 'center',
      marginVertical: 12,
    },
    modalActionBtnText: {
      color: theme.buttonPrimaryText,
      fontWeight: '800',
      fontSize: 13,
    },
    smsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.borderSubtle,
    },
    smsTitle: {
      color: theme.textPrimary,
      fontSize: 13,
      fontWeight: '600',
    },
    smsMeta: {
      color: theme.textTertiary,
      fontSize: 11,
      marginTop: 2,
    },
    importBtn: {
      padding: 6,
    },
    modalCloseBtn: {
      backgroundColor: theme.surfaceSubtle,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: 'center',
      marginTop: 10,
      borderWidth: 1,
      borderColor: theme.borderStrong,
    },
    modalCloseBtnText: {
      color: theme.textPrimary,
      fontWeight: '600',
      fontSize: 13,
    },

    /* Wealth Pillars */
    miniWealthCard: {
      flex: 1,
      paddingVertical: 10,
      paddingHorizontal: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.borderStrong,
    },
    miniWealthLabel: {
      fontSize: 8,
      fontWeight: '700',
      letterSpacing: 0.8,
      marginBottom: 3,
    },
    miniWealthVal: {
      fontSize: 12,
      fontWeight: '800',
    },

    /* Category Level Breakdown */
    catCard: {
      borderRadius: 14,
      padding: 12,
      borderWidth: 1,
      borderColor: theme.borderStrong,
    },
    catCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    catIconWrap: {
      width: 32,
      height: 32,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
    },
    catName: {
      fontSize: 13,
      fontWeight: '700',
    },
    catSub: {
      fontSize: 11,
      marginTop: 1,
    },
    catAmount: {
      fontSize: 13,
      fontWeight: '800',
    },
    catPercent: {
      fontSize: 11,
      fontWeight: '600',
      marginTop: 1,
    },
    catProgressTrack: {
      height: 4,
      borderRadius: 2,
      marginTop: 10,
      overflow: 'hidden',
    },
    catProgressBar: {
      height: 4,
      borderRadius: 2,
    },
    catExpandedList: {
      marginTop: 12,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: theme.borderSubtle,
      gap: 8,
    },
    catTxRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 4,
    },
    catTxMemo: {
      fontSize: 12,
      fontWeight: '600',
    },
    catTxDate: {
      fontSize: 10,
      marginTop: 1,
    },
    catTxAmount: {
      fontSize: 12,
      fontWeight: '700',
    },
  });
