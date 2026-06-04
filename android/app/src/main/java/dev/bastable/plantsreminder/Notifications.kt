package dev.bastable.plantsreminder

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat

/** The reminder notification: channel setup + builder. */
object Notifications {
    private const val CHANNEL_ID = "plants-reminder"
    private const val NOTIFICATION_ID = 1

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = context.getSystemService(NotificationManager::class.java)
        if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
        // HIGH so it heads-up on a freshly-booted phone — the reminder is the whole app.
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Daily plant reminder",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "The morning reminder to water/feed what's due."
        }
        mgr.createNotificationChannel(channel)
    }

    fun show(context: Context, title: String, body: String) {
        ensureChannel(context)

        // Opens the installed Plants PWA (WebAPK) at the Today tab, else Chrome at that URL.
        val viewPI = PendingIntent.getActivity(
            context,
            0,
            Intent(Intent.ACTION_VIEW, Uri.parse(ReminderScheduler.PWA_URL)),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_plant)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(viewPI)
            .build()

        context.getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, notification)
    }
}
