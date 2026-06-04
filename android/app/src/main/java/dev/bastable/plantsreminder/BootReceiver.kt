package dev.bastable.plantsreminder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Re-arms the daily alarm after a reboot. The nightly power-off is exactly what killed
 * the Web Push subscription; here it instead triggers a fresh re-schedule, so the 07:30
 * reminder survives the very event that broke the old approach.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            "android.intent.action.QUICKBOOT_POWERON" -> {
                Log.i(ReminderScheduler.TAG, "boot — re-arming reminder")
                ReminderScheduler.scheduleNext(context.applicationContext)
            }
        }
    }
}
