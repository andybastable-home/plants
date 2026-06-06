package dev.bastable.plantsreminder

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import java.util.Calendar

/**
 * Schedules the daily reminder as an exact, Doze-exempt local alarm.
 *
 * This is the whole point of the native companion: an exact, Doze-exempt alarm wakes the
 * phone *itself* at 07:30 — no FCM, no push subscription, no internet-at-fire-time, and it
 * survives a reboot via [BootReceiver]. That is precisely what Web Push could not do on a
 * never-opened PWA across the nightly power-off.
 *
 * Uses [AlarmManager.setExactAndAllowWhileIdle] rather than [AlarmManager.setAlarmClock]:
 * both fire exactly and through Doze, but setAlarmClock is treated as a literal alarm-clock
 * alarm and forces the status-bar alarm icon + lock-screen "next alarm" entry. For a once-
 * daily reminder on a stock Pixel that icon buys nothing — the once-per-9-min throttle on
 * *AndAllowWhileIdle alarms is irrelevant here — so we drop it. Covered by the manifest's
 * USE_EXACT_ALARM (auto-granted). Trade-off: no clock-app entry, so "is it armed?" is only
 * checkable via "Test reminder now" / logcat, not at a glance.
 */
object ReminderScheduler {
    const val TAG = "PlantsReminder"

    // Where the AlarmReceiver fetches the due-count from (the existing Cloudflare worker).
    const val WORKER_URL = "https://plants.plants-andyb.workers.dev"
    const val PUSH_TOKEN = "SuperSecretPlants837492!"
    // Tapping the notification opens the installed Plants PWA (WebAPK) on the Today tab.
    const val PWA_URL = "https://andybastable-home.github.io/plants/?tab=today"

    const val HOUR = 7
    const val MIN = 30

    private const val ALARM_REQUEST = 1001

    /** Compute the next 07:30 local and arm an exact alarm clock for it. */
    fun scheduleNext(context: Context) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

        val now = Calendar.getInstance()
        val next = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, HOUR)
            set(Calendar.MINUTE, MIN)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
            if (!after(now)) add(Calendar.DAY_OF_MONTH, 1)
        }

        val alarmPI = PendingIntent.getBroadcast(
            context,
            ALARM_REQUEST,
            Intent(context, AlarmReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.timeInMillis, alarmPI)
        Log.i(TAG, "Next reminder armed for ${next.time}")
    }
}
