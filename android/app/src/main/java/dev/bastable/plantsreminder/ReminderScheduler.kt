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
 * This is the whole point of the native companion: a [AlarmManager.setAlarmClock] alarm
 * wakes the phone *itself* at 07:30 — no FCM, no push subscription, no internet-at-fire-time,
 * and it survives a reboot via [BootReceiver]. That is precisely what Web Push could not do
 * on a never-opened PWA across the nightly power-off.
 *
 * MUST stay [AlarmManager.setAlarmClock], NOT setExactAndAllowWhileIdle. v0.1.1 swapped to
 * the latter to drop the status-bar alarm icon, and the 07:30 reminder silently stopped
 * firing overnight (v0.1.2 reverted). Reason: this companion is *never opened* — you only
 * ever see its notification — so Android demotes it into the `rare`/`restricted` App Standby
 * bucket, where setExactAndAllowWhileIdle alarms are throttled/deferred (Doze-exempt is not
 * enough; App Standby is a separate axis). setAlarmClock is exempt from *both* Doze and App
 * Standby — the only Android wakeup reliable for an app the user never touches. The permanent
 * status-bar alarm icon is the price of that reliability, and doubles as an at-a-glance
 * "is it armed?" indicator. Do not trade it away again.
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
        // Shown if the user inspects the pending alarm (e.g. clock app) — opens the app.
        val showPI = PendingIntent.getActivity(
            context,
            ALARM_REQUEST,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        am.setAlarmClock(AlarmManager.AlarmClockInfo(next.timeInMillis, showPI), alarmPI)
        Log.i(TAG, "Next reminder armed for ${next.time}")
    }
}
