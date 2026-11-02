import { PermissionsAndroid, Platform } from 'react-native';
import SmsAndroid from 'react-native-get-sms-android';

export interface ParsedSmsTransaction {
  id: string;
  amount: number;
  type: 'inflow' | 'outflow';
  details: string;
  category: string;
  date: string;
  sender: string;
}

export const getSuggestedCategory = (details: string, type: 'inflow' | 'outflow'): string => {
  const text = details.toLowerCase();
  if (type === 'inflow') return 'Income';

  if (text.includes('swiggy') || text.includes('zomato') || text.includes('food') || text.includes('restaurant') || text.includes('cafe')) {
    return 'Food & Dining';
  }
  if (text.includes('uber') || text.includes('ola') || text.includes('rapido') || text.includes('petrol') || text.includes('fuel') || text.includes('auto')) {
    return 'Transportation';
  }
  if (text.includes('amazon') || text.includes('flipkart') || text.includes('myntra') || text.includes('mall') || text.includes('store')) {
    return 'Shopping';
  }
  if (text.includes('recharge') || text.includes('jio') || text.includes('airtel') || text.includes('bill') || text.includes('electricity') || text.includes('wifi')) {
    return 'Bills & Utilities';
  }
  if (text.includes('movie') || text.includes('netflix') || text.includes('bookmyshow') || text.includes('spotify')) {
    return 'Entertainment';
  }
  if (text.includes('medical') || text.includes('hospital') || text.includes('pharmacy') || text.includes('apollo')) {
    return 'Health & Medical';
  }
  return 'General Expense';
};

export const requestSmsPermission = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return false;

  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      {
        title: 'SMS Permission Required',
        message: 'Expense Tracker needs permission to read bank & UPI transaction SMS to automatically log expenses.',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'Grant Permission',
      }
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch (err) {
    console.warn(err);
    return false;
  }
};

export const parseSmsText = (body: string, sender: string, dateMs: number): ParsedSmsTransaction | null => {
  const cleanBody = body.replace(/\n/g, ' ');

  // Look for amount pattern: Rs. 500, Rs 500.00, INR 500, ₹ 500
  const amountMatch = cleanBody.match(/(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i) ||
                     cleanBody.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:INR|Rs\.?|₹)/i);

  if (!amountMatch) return null;

  const rawAmount = amountMatch[1].replace(/,/g, '');
  const amount = parseFloat(rawAmount);
  if (isNaN(amount) || amount <= 0) return null;

  const lowerBody = cleanBody.toLowerCase();

  // Strong Debit / Outflow indicators
  const isDebitKeyword = /\b(debited|spent|paid|sent|withdrawn|dr|dr\.|paid to|spent on|purchase|txn of)\b/i.test(lowerBody);
  // Strong Credit / Inflow indicators
  const isCreditKeyword = /\b(credited|received|deposited|added|cr|cr\.|credited to|received from)\b/i.test(lowerBody);

  let type: 'inflow' | 'outflow' = 'outflow';

  if (isDebitKeyword && !isCreditKeyword) {
    type = 'outflow';
  } else if (isCreditKeyword && !isDebitKeyword) {
    type = 'inflow';
  } else if (isDebitKeyword && isCreditKeyword) {
    // If both keywords exist (e.g., "Rs 500 debited... Avail bal credited..."),
    // find index of debit vs credit keywords
    const debitIndex = Math.min(
      ...['debited', 'spent', 'paid', 'sent', 'withdrawn', 'dr'].map(k => {
        const idx = lowerBody.indexOf(k);
        return idx === -1 ? Infinity : idx;
      })
    );
    const creditIndex = Math.min(
      ...['credited', 'received', 'deposited', 'added', 'cr'].map(k => {
        const idx = lowerBody.indexOf(k);
        return idx === -1 ? Infinity : idx;
      })
    );

    // Usually the primary action occurs first in the SMS
    type = debitIndex <= creditIndex ? 'outflow' : 'inflow';
  } else {
    // Default to outflow if ambiguous (most bank notification SMS are expenses)
    type = 'outflow';
  }

  // Extract merchant or recipient details
  let merchant = 'Bank Transaction';
  const vendorMatch =
    cleanBody.match(/(?:to|at|info:?|vpa|paid to|spent at)\s+([A-Za-z0-9\s._\-&]+?)(?:\s+on|\s+ref|\s+avail|\s+a\/c|\s+bal|\.|$)/i) ||
    cleanBody.match(/(?:from)\s+([A-Za-z0-9\s._\-&]+?)(?:\s+on|\s+ref|\s+avail|\s+a\/c|\.|$)/i);

  if (vendorMatch && vendorMatch[1].trim().length > 1) {
    merchant = vendorMatch[1].trim().slice(0, 40);
  }

  const category = getSuggestedCategory(merchant, type);
  const formattedDate = new Date(dateMs).toISOString().split('T')[0];

  return {
    id: `sms_${dateMs}_${Math.random().toString(36).substr(2, 5)}`,
    amount,
    type,
    details: merchant,
    category,
    date: formattedDate,
    sender,
  };
};

export const fetchBankTransactionsFromSMS = async (): Promise<ParsedSmsTransaction[]> => {
  const hasPermission = await requestSmsPermission();
  if (!hasPermission) {
    throw new Error('SMS permission was denied by the user.');
  }

  return new Promise((resolve, reject) => {
    const filter = {
      box: 'inbox',
      maxCount: 100,
    };

    SmsAndroid.list(
      JSON.stringify(filter),
      (fail: string) => {
        reject(new Error(`Failed to list SMS: ${fail}`));
      },
      (count: number, smsListStr: string) => {
        try {
          const parsed = JSON.parse(smsListStr);
          const results: ParsedSmsTransaction[] = [];

          for (const item of parsed) {
            const body = item.body || '';
            const address = item.address || '';
            const date = item.date ? parseInt(item.date, 10) : Date.now();

            // Filter financial / bank / payment SMS
            if (
              /bank|hdfc|icici|sbi|axis|kotak|phonepe|gpay|paytm|cred|slice|upi|debited|credited/i.test(
                address + ' ' + body
              )
            ) {
              const tx = parseSmsText(body, address, date);
              if (tx) {
                results.push(tx);
              }
            }
          }

          resolve(results);
        } catch (e) {
          reject(e);
        }
      }
    );
  });
};
