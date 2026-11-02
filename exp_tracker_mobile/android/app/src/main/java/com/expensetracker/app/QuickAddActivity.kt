package com.expensetracker.app

import android.app.Activity
import android.content.Context
import android.os.Bundle
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread

class QuickAddActivity : Activity() {

    private val supabaseUrl = "https://oncwixlyyebpgzihizvn.supabase.co/rest/v1/transactions"
    private val supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uY3dpeGx5eWVicGd6aWhpenZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNDgyNzcsImV4cCI6MjA5NTYyNDI3N30.oFDz9c4xiGMaMqUInoK6i4hMKxm7oVewJrzFNe3kzi8"

    private var selectedCategory = "Food & Dining"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_quick_add)

        val etAmount = findViewById<EditText>(R.id.et_amount)
        val etMemo = findViewById<EditText>(R.id.et_memo)
        val btnClose = findViewById<TextView>(R.id.btn_close)
        val btnSave = findViewById<Button>(R.id.btn_save)

        val btnQuick50 = findViewById<TextView>(R.id.btn_quick_50)
        val btnQuick100 = findViewById<TextView>(R.id.btn_quick_100)
        val btnQuick200 = findViewById<TextView>(R.id.btn_quick_200)
        val btnQuick500 = findViewById<TextView>(R.id.btn_quick_500)

        fun addQuickAmount(valToAdd: Double) {
            val currentVal = etAmount.text.toString().toDoubleOrNull() ?: 0.0
            val newVal = currentVal + valToAdd
            etAmount.setText(if (newVal % 1.0 == 0.0) newVal.toLong().toString() else String.format(Locale.US, "%.2f", newVal))
            etAmount.setSelection(etAmount.text.length)
        }

        btnQuick50.setOnClickListener { addQuickAmount(50.0) }
        btnQuick100.setOnClickListener { addQuickAmount(100.0) }
        btnQuick200.setOnClickListener { addQuickAmount(200.0) }
        btnQuick500.setOnClickListener { addQuickAmount(500.0) }

        val chipFood = findViewById<TextView>(R.id.chip_food)
        val chipTransport = findViewById<TextView>(R.id.chip_transport)
        val chipShopping = findViewById<TextView>(R.id.chip_shopping)
        val chipBills = findViewById<TextView>(R.id.chip_bills)
        val chipLent = findViewById<TextView>(R.id.chip_lent)
        val chipGeneral = findViewById<TextView>(R.id.chip_general)

        val chips = listOf(
            Triple(chipFood, "Food & Dining", "🍔 Food"),
            Triple(chipTransport, "Transportation", "🚗 Transport"),
            Triple(chipShopping, "Shopping", "🛒 Shopping"),
            Triple(chipBills, "Bills & Utilities", "💡 Bills"),
            Triple(chipLent, "Debt", "🤝 Lent"),
            Triple(chipGeneral, "General Expense", "⚡ Other")
        )

        fun updateChips(activeCategory: String) {
            selectedCategory = activeCategory
            val selectedTextColor = ContextCompat.getColor(this, R.color.chip_selected_text)
            val unselectedTextColor = ContextCompat.getColor(this, R.color.chip_unselected_text)
            for ((view, cat, _) in chips) {
                if (cat == activeCategory) {
                    view.setBackgroundResource(R.drawable.chip_selected)
                    view.setTextColor(selectedTextColor)
                } else {
                    view.setBackgroundResource(R.drawable.chip_unselected)
                    view.setTextColor(unselectedTextColor)
                }
            }
        }

        chipFood.setOnClickListener { updateChips("Food & Dining") }
        chipTransport.setOnClickListener { updateChips("Transportation") }
        chipShopping.setOnClickListener { updateChips("Shopping") }
        chipBills.setOnClickListener { updateChips("Bills & Utilities") }
        chipLent.setOnClickListener { updateChips("Debt") }
        chipGeneral.setOnClickListener { updateChips("General Expense") }

        // Parse any incoming parameters from Uri (e.g. from SMS receiver or shortcuts)
        intent?.data?.let { uri ->
            uri.getQueryParameter("amount")?.let { etAmount.setText(it) }
            uri.getQueryParameter("memo")?.let { etMemo.setText(it) }
            uri.getQueryParameter("category")?.let { updateChips(it) }
        }

        // Close on ✕ button
        btnClose.setOnClickListener {
            finish()
        }

        // Auto-focus amount input and show keyboard
        etAmount.requestFocus()
        etAmount.postDelayed({
            val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            imm.showSoftInput(etAmount, InputMethodManager.SHOW_IMPLICIT)
        }, 150)

        // Save & Close action
        btnSave.setOnClickListener {
            val amtStr = etAmount.text.toString().trim()
            val amount = amtStr.toDoubleOrNull()
            if (amount == null || amount <= 0) {
                Toast.makeText(this, "Please enter a valid amount", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            val memo = etMemo.text.toString().trim().ifBlank { selectedCategory }
            val dateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
            val dateStr = dateFormat.format(Date())

            // Post to Supabase in a quick background thread
            thread {
                try {
                    val url = URL(supabaseUrl)
                    val conn = url.openConnection() as HttpURLConnection
                    conn.requestMethod = "POST"
                    conn.setRequestProperty("apikey", supabaseKey)
                    conn.setRequestProperty("Authorization", "Bearer $supabaseKey")
                    conn.setRequestProperty("Content-Type", "application/json")
                    conn.setRequestProperty("Prefer", "return=minimal")
                    conn.doOutput = true
                    conn.connectTimeout = 4000
                    conn.readTimeout = 4000

                    val payload = JSONObject().apply {
                        put("type", "outflow")
                        put("amount", amount)
                        put("tier1_category", selectedCategory)
                        put("tier2_memo", memo)
                        put("date", dateStr)
                    }

                    OutputStreamWriter(conn.outputStream).use { writer ->
                        writer.write(payload.toString())
                        writer.flush()
                    }

                    val code = conn.responseCode
                    conn.disconnect()

                    // If tagged as Lent (Debt), automatically create a pending debt entry
                    if (selectedCategory == "Debt") {
                        try {
                            val pmUrl = URL("https://oncwixlyyebpgzihizvn.supabase.co/rest/v1/planned_movements")
                            val pmConn = pmUrl.openConnection() as HttpURLConnection
                            pmConn.requestMethod = "POST"
                            pmConn.setRequestProperty("apikey", supabaseKey)
                            pmConn.setRequestProperty("Authorization", "Bearer $supabaseKey")
                            pmConn.setRequestProperty("Content-Type", "application/json")
                            pmConn.setRequestProperty("Prefer", "return=minimal")
                            pmConn.doOutput = true
                            val pmPayload = JSONObject().apply {
                                put("type", "debt_given")
                                put("title", memo)
                                put("amount", amount)
                                put("due_date", dateStr)
                                put("status", "pending")
                                put("is_recurring", false)
                                put("reminder_days_before", 1)
                            }
                            OutputStreamWriter(pmConn.outputStream).use { writer ->
                                writer.write(pmPayload.toString())
                                writer.flush()
                            }
                            pmConn.responseCode
                            pmConn.disconnect()
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }

            // Immediately close and inform user
            Toast.makeText(this, "✅ Logged ₹$amount to $selectedCategory", Toast.LENGTH_SHORT).show()
            finish()
        }
    }
}
