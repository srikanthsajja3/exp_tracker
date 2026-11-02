package com.expensetracker.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

class ExpenseWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (appWidgetId in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId)
        }
    }

    companion object {
        fun updateAppWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
            val views = RemoteViews(context.packageName, R.layout.widget_expense)

            // Intent for Quick Add (Opens Floating System Popup)
            val quickAddIntent = Intent(context, QuickAddActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val quickAddPendingIntent = PendingIntent.getActivity(
                context,
                1001,
                quickAddIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.btn_quick_add, quickAddPendingIntent)

            // Intent for Scan SMS
            val scanSmsIntent = Intent(Intent.ACTION_VIEW, Uri.parse("expensetracker://scan-sms")).apply {
                setPackage(context.packageName)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val scanSmsPendingIntent = PendingIntent.getActivity(
                context,
                1002,
                scanSmsIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.btn_scan_sms, scanSmsPendingIntent)

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}
