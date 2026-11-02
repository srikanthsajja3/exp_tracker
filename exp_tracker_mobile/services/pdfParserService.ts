import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { getSuggestedCategory } from './smsParserService';

export interface ParsedPdfTx {
  date: string;
  time: string;
  details: string;
  type: 'inflow' | 'outflow';
  amount: number;
  category: string;
}

export const extractPhonePeTransactionsFromText = (text: string): ParsedPdfTx[] => {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const transactions: ParsedPdfTx[] = [];

  for (let i = 0; i < lines.length; i++) {
    const dateMatch = lines[i].match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2},\s+\d{4}$/);

    if (dateMatch) {
      const date = lines[i];
      const timeMatch = lines[i + 1]?.match(/^\d{2}:\d{2}\s+(AM|PM)$/);

      if (timeMatch && i + 2 < lines.length) {
        const time = lines[i + 1];
        const details = lines[i + 2];

        let amountLine = '';
        for (let j = i + 3; j < Math.min(i + 10, lines.length); j++) {
          if (lines[j].includes('Credit INR') || lines[j].includes('Debit INR')) {
            amountLine = lines[j];
            break;
          }
        }

        if (amountLine) {
          const amountMatch = amountLine.match(/^(Credit|Debit) INR\s+([\d,.]+)/);
          if (amountMatch) {
            const type = amountMatch[1] === 'Credit' ? 'inflow' : 'outflow';
            const amount = parseFloat(amountMatch[2].replace(/,/g, ''));

            let formattedDate = new Date().toISOString().split('T')[0];
            try {
              const d = new Date(date);
              if (!isNaN(d.getTime())) {
                formattedDate = d.toISOString().split('T')[0];
              }
            } catch (e) {}

            transactions.push({
              date: formattedDate,
              time,
              details,
              type,
              amount,
              category: getSuggestedCategory(details, type),
            });
          }
        }
      }
    }
  }

  return transactions;
};

export const pickAndParsePdfStatement = async (): Promise<ParsedPdfTx[]> => {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return [];
  }

  const fileUri = result.assets[0].uri;
  // Read base64 content
  const fileContentBase64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // Extract raw ASCII text from PDF stream
  const binaryString = atob(fileContentBase64);
  const parsedTxs = extractPhonePeTransactionsFromText(binaryString);

  return parsedTxs;
};
