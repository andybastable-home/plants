package dev.bastable.plantsreminder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Fired by the daily exact alarm. Fetches today's due-count from the worker's `/diag`,
 * posts the reminder notification, and — crucially — re-arms tomorrow's alarm so the
 * chain continues. Fails *toward* reminding: any fetch error → generic notification.
 */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        val appContext = context.applicationContext
        Thread {
            try {
                fetchAndNotify(appContext)
            } catch (t: Throwable) {
                Log.e(ReminderScheduler.TAG, "reminder failed", t)
            } finally {
                // Re-arm the daily chain no matter what happened above.
                ReminderScheduler.scheduleNext(appContext)
                pending.finish()
            }
        }.start()
    }

    companion object {
        /**
         * Blocking GET of `/diag` → notification. Safe to call from a background thread.
         * - total > 0  → "<w> to water · <f> to feed today 🌱"
         * - total == 0 → no notification (nothing due — mirrors the old worker behaviour)
         * - fetch fails → generic "Time to check your plants 🌱" (fail toward reminding)
         */
        fun fetchAndNotify(context: Context) {
            val due = try {
                fetchDue()
            } catch (t: Throwable) {
                Log.w(ReminderScheduler.TAG, "diag fetch failed, using generic reminder", t)
                null
            }

            if (due == null) {
                Notifications.show(context, "Plants 🌱", "Time to check your plants 🌱")
                return
            }

            if (due.total <= 0) {
                Log.i(ReminderScheduler.TAG, "nothing due — staying silent")
                return
            }

            Notifications.show(context, "Plants 🌱", buildBody(due))
        }

        private data class Due(val water: Int, val feed: Int, val total: Int)

        private fun buildBody(due: Due): String {
            val parts = mutableListOf<String>()
            if (due.water > 0) parts.add("${due.water} to water")
            if (due.feed > 0) parts.add("${due.feed} to feed")
            return parts.joinToString(" · ") + " today 🌱"
        }

        private fun fetchDue(): Due {
            val url = URL("${ReminderScheduler.WORKER_URL}/diag?token=${ReminderScheduler.PUSH_TOKEN}")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 5000
                readTimeout = 5000
            }
            try {
                val text = conn.inputStream.bufferedReader().use { it.readText() }
                val dueToday = JSONObject(text).getJSONObject("dueToday")
                return Due(
                    water = dueToday.optInt("water", 0),
                    feed = dueToday.optInt("feed", 0),
                    total = dueToday.optInt("total", 0),
                )
            } finally {
                conn.disconnect()
            }
        }
    }
}
