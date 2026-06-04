package dev.bastable.plantsreminder

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat

/**
 * Minimal status + manual-test screen. Not the product — the product is the 07:30
 * notification. This exists only to verify delivery on-device without waiting for 07:30.
 */
class MainActivity : Activity() {

    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val pad = (24 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(pad, pad, pad, pad)
        }

        status = TextView(this).apply {
            textSize = 16f
            setPadding(0, 0, 0, pad)
        }
        root.addView(status)

        // Runs the exact alarm path (fetch /diag + notify) immediately.
        root.addView(Button(this).apply {
            text = "Test reminder now"
            setOnClickListener {
                Toast.makeText(this@MainActivity, "Fetching…", Toast.LENGTH_SHORT).show()
                Thread { AlarmReceiver.fetchAndNotify(applicationContext) }.start()
            }
        })

        root.addView(Button(this).apply {
            text = "Re-schedule"
            setOnClickListener {
                ReminderScheduler.scheduleNext(applicationContext)
                refreshStatus()
                Toast.makeText(this@MainActivity, "Re-scheduled", Toast.LENGTH_SHORT).show()
            }
        })

        setContentView(root)

        requestNotificationPermissionIfNeeded()
        ReminderScheduler.scheduleNext(applicationContext)
        refreshStatus()
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    private fun refreshStatus() {
        val notifGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
        status.text = buildString {
            append("Next reminder: ")
            append(String.format("%02d:%02d", ReminderScheduler.HOUR, ReminderScheduler.MIN))
            append(" daily\n\n")
            append("Notifications: ")
            append(if (notifGranted) "allowed ✓" else "not allowed — tap to grant")
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refreshStatus()
    }
}
