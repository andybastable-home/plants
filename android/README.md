# Plants Reminder (native companion)

A tiny native Android companion to the **Plants PWA**. Its only job is the daily
**07:30 reminder** — the one feature Web Push could not deliver reliably.

## Why this exists

Andy turns his Pixel 8a **off** overnight and powers it on ~06:30, deliberately **not**
opening the Plants PWA — the notification is what reminds him to. Three mornings of `/diag`
instrumentation proved Web Push can't serve this: the nightly reboot invalidates the push
subscription (`410 Gone`), and a never-opened PWA has no reliable way to re-register
(`pushsubscriptionchange` is for browser key rotation, not OS teardown; the service worker
isn't woken on a closed app). That's the structural ceiling of Web Push here.

The fix is a **local alarm**. `AlarmManager.setAlarmClock` fires in Doze and is re-armed on
boot, so the phone wakes *itself* — no FCM, no subscription, no cron, no internet required at
fire time. The PWA (6 phases of CRUD + Sheets sync + Gemini) is untouched; this just bolts on
the reliable reminder.

## How it works

- **`ReminderScheduler.scheduleNext`** computes the next 07:30 local and arms an exact
  `setAlarmClock` alarm (Doze-exempt).
- **`AlarmReceiver`** fires at 07:30: GETs the existing Cloudflare worker's
  `/diag?token=…`, reads `dueToday.{water,feed,total}`, and posts the notification —
  `"<w> to water · <f> to feed today 🌱"` when something's due, nothing when `total==0`,
  and a generic `"Time to check your plants 🌱"` if the fetch fails (fails *toward*
  reminding). It always re-arms tomorrow's alarm.
- **`BootReceiver`** re-arms the alarm after a reboot — the exact event that broke Web Push.
- Tapping the notification opens the installed Plants PWA on the Today tab.

The worker stays as a **due-count data endpoint only**; its cron + Web Push send are now dead
weight (retained for reference, can be deleted in a later cleanup).

## Building (borrowed Unity toolchain)

This machine has no standalone Android Studio. The build reuses the Android SDK + JDK
bundled with **Unity 6000.5.0b7**, plus the Gradle that ships with it — identical to the
sister project `bike-dashboard`.

- **Android SDK** (`local.properties` → `sdk.dir`):
  `…/Unity/Hub/Editor/6000.5.0b7/Editor/Data/PlaybackEngines/AndroidPlayer/SDK`
- **JDK 17** (set `JAVA_HOME` before building): `…/AndroidPlayer/OpenJDK`
- `compileSdk 36` / `targetSdk 34` / `minSdk 26`, build-tools `36.0.0`.

```powershell
$env:JAVA_HOME = "C:\Program Files\Unity\Hub\Editor\6000.5.0b7\Editor\Data\PlaybackEngines\AndroidPlayer\OpenJDK"
./gradlew assembleDebug
```

`local.properties` is gitignored — recreate it on a new machine with `sdk.dir` pointing at a
valid SDK:

```
sdk.dir=C:/Program Files/Unity/Hub/Editor/6000.5.0b7/Editor/Data/PlaybackEngines/AndroidPlayer/SDK
```

## Installing on the Pixel 8a

Standalone `adb` lives at `C:\Program Files\Google\platform-tools\adb.exe`.

```powershell
& "C:\Program Files\Google\platform-tools\adb.exe" install -r app/build/outputs/apk/debug/app-debug.apk
```

## Verifying

1. Launch once → grant the notification permission.
2. Tap **Test reminder now** → a `"X to water · Y to feed today 🌱"` notification appears
   (or the generic line if offline); tapping it opens the Plants PWA on the Today tab.
3. **Reboot test (the real one):** confirm a reminder is scheduled, power the phone off,
   power it back on, leave Plants **unopened**, and confirm the 07:30 notification fires and
   re-arms for the next day.
4. Airplane-mode + **Test reminder now** → the generic fallback still appears (offline path).

## Out of scope (fast-follows)

- **"This evening" defer** — a notification action that arms a one-shot 18:00 alarm.
- **Retiring the worker's cron/push code** — once the companion is trusted on-device.
