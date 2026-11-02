package com.expensetracker.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Telephony
import androidx.core.app.NotificationCompat
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.regex.Pattern

class SmsReceiver : BroadcastReceiver() {

    companion object {
        const val CHANNEL_ID = "payment_detected_channel"
        const val CHANNEL_NAME = "Instant Payment Alerts"
        const val NOTIFICATION_ID_BASE = 8000
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        val fullBodyBuilder = StringBuilder()
        var sender = ""

        for (sms in messages) {
            fullBodyBuilder.append(sms.messageBody)
            if (sender.isEmpty()) {
                sender = sms.originatingAddress ?: ""
            }
        }

        val body = fullBodyBuilder.toString()
        if (body.isBlank()) return

        // Process financial transaction
        val parsed = parseFinancialSms(body, sender) ?: return

        // Show High-Priority Heads-Up notification with deep link to Quick Add form
        showPaymentNotification(context, parsed)
    }

    data class ParsedTransaction(
        val amount: Double,
        val type: String, // "outflow" or "inflow"
        val merchant: String,
        val date: String
    )

    private fun parseFinancialSms(body: String, sender: String): ParsedTransaction? {
        val cleanBody = body.replace("\n", " ")
        val lower = cleanBody.lowercase(Locale.ROOT)

        // Check for financial keywords
        val isFinancial = lower.contains("debited") || lower.contains("spent") ||
                lower.contains("paid") || lower.contains("withdrawn") ||
                lower.contains("credited") || lower.contains("received") ||
                lower.contains("txn") || lower.contains("a/c") ||
                lower.contains("upi") || sender.lowercase(Locale.ROOT).contains("bank")

        if (!isFinancial) return null

        // Ignore OTP or balance inquiry without transaction
        if (lower.contains("otp") || lower.contains("secret code") || lower.contains("request for registering")) {
            return null
        }

        // Amount pattern
        val amtPattern = Pattern.compile("(?:inr|rs\\.?|₹)\\s*([\\d,]+(?:\\.\\d{1,2})?)", Pattern.CASE_INSENSITIVE)
        val amtMatcher = amtPattern.matcher(cleanBody)
        if (!amtMatcher.find()) return null

        val amtStr = amtMatcher.group(1)?.replace(",", "") ?: return null
        val amount = amtStr.toDoubleOrNull() ?: return null
        if (amount <= 0) return null

        // Type determination
        val isDebit = lower.contains("debited") || lower.contains("spent") ||
                lower.contains("paid") || lower.contains("withdrawn") || lower.contains("purchase")
        val isCredit = lower.contains("credited") || lower.contains("received") || lower.contains("deposited")

        val type = if (isDebit && !isCredit) {
            "outflow"
        } else if (isCredit && !isDebit) {
            "inflow"
        } else if (isDebit && isCredit) {
            val dIdx = listOf("debited", "spent", "paid", "sent", "withdrawn")
                .map { lower.indexOf(it) }.filter { it != -1 }.minOrNull() ?: Int.MAX_VALUE
            val cIdx = listOf("credited", "received", "deposited")
                .map { lower.indexOf(it) }.filter { it != -1 }.minOrNull() ?: Int.MAX_VALUE
            if (dIdx <= cIdx) "outflow" else "inflow"
        } else {
            "outflow"
        }

        // Merchant extraction
        var merchant = "Bank Transaction"
        val vendorPattern = Pattern.compile("(?:to|at|info:?|vpa|paid to|spent at)\\s+([A-Za-z0-9\\s._\\-&]+?)(?:\\s+on|\\s+ref|\\s+avail|\\s+a/c|\\s+bal|\\.|,|$)", Pattern.CASE_INSENSITIVE)
        val vendorMatcher = vendorPattern.matcher(cleanBody)
        if (vendorMatcher.find()) {
            val v = vendorMatcher.group(1)?.trim() ?: ""
            if (v.length > 1 && !v.lowercase(Locale.ROOT).contains("your account")) {
                merchant = if (v.length > 35) v.substring(0, 35) else v
            }
        }

        val dateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        val dateStr = dateFormat.format(Date())

        return ParsedTransaction(amount, type, merchant, dateStr)
    }

    private fun showPaymentNotification(context: Context, tx: ParsedTransaction) {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Create notification channel with MAX / HIGH importance for Heads-Up banner
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Immediate prompt to log expense when a bank transaction occurs"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 250, 100, 250)
            }
            notificationManager.createNotificationChannel(channel)
        }

        val encodedMemo = try {
            URLEncoder.encode(tx.merchant, "UTF-8")
        } catch (e: Exception) {
            tx.merchant
        }

        val deepLinkUri = Uri.parse("expensetracker://quick-add?amount=${tx.amount}&memo=${encodedMemo}&type=${tx.type}&date=${tx.date}")

        val contentIntent = Intent(context, QuickAddActivity::class.java).apply {
            data = deepLinkUri
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }

        val pendingIntent = PendingIntent.getActivity(
            context,
            System.currentTimeMillis().toInt(),
            contentIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val symbol = if (tx.type == "outflow") "💸" else "💰"
        val actionText = if (tx.type == "outflow") "Paid" else "Received"
        val title = "$symbol $actionText ₹${String.format(Locale.US, "%.2f", tx.amount)} to ${tx.merchant}"
        val text = "Tap to review & log this transaction to your Expense Tracker"

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_EVENT)
            .setAutoCancel(true)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setContentIntent(pendingIntent)
            .addAction(R.mipmap.ic_launcher, "⚡ 1-Tap Log", pendingIntent)
            .build()

        notificationManager.notify((NOTIFICATION_ID_BASE + (System.currentTimeMillis() % 1000)).toInt(), notification)
    }
}
