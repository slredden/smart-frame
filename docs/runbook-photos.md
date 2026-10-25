# Runbook: pick a new photo set

Photos come from Google Photos through the Picker API (Stephen's personal Google account). Up to 300
per set, shown for 60 seconds each in shuffled order, with a small date caption.

1. On a phone or computer (not the frame), open `/admin` → Photos → **Pick new photos**.
2. Google's picker opens. Choose up to 300 photos and press Done.
3. Keep `/admin` open (or reopen it later; it resumes). It copies photos in batches of 20 and shows progress. The frame keeps showing
   the old set until the new one is complete, then switches over in one step.

## On the frame (P1b)

The Photos screen shows the set full screen. Tap for the toolbar (it hides after 5 s): ‹ Pause/Play ›,
♥ favorite, **Hide** (5 s undo), and **Options**: interval (15 s–5 min), shuffle or picked order,
fit or fill, captions, favorites only (falls back to every photo when none is a favorite). Options are
saved in D1 (`settings.photos`) and also apply behind Home. Favorites and hides are D1 rows (no KV
writes); /admin → Photos → **Unhide all** brings hidden photos back.

## Limits (Workers Free plan)

- Each photo is one KV write, and KV allows 1,000 writes a day. The Worker keeps its own budget of
  900 a day (UTC). A new set is refused if it would exceed today's budget. A copy that hits the budget
  pauses; open `/admin` again after midnight UTC (6 PM Denver in MDT, 5 PM in MST) and it picks up
  where it stopped.
- At most one new 300-photo set per day.

## Sets and cleanup (P1c)

A set is `building` while it copies, then `active` when it goes live. At that moment the old active set
becomes `previous`, and the old `previous` becomes `retired`. Only the active and previous sets are
kept.

- **Cleanup is automatic.** The 5-minute cron deletes the photos of `retired` sets, oldest first. It
  also deletes failed or stuck copies: a set still `building` with a failed job, or with no live job
  and over 24 hours old. Each photo is one KV delete. The Worker keeps its own budget of **900 deletes per UTC
  day** (KV's limit is 1,000 and it doesn't share the write budget). It runs up to 3 sets × 50 keys per
  run and resumes the next UTC day when the budget runs out. The D1 rows go only after all of a set's
  KV keys are gone, and then the set is marked `purged`. An interrupted run picks up where it stopped.
- **Never deleted:** the active set, the previous set, and a set that is still copying. Each batch
  checks this again, so a set that changes state during a run is left alone.
- **Restore previous set:** /admin › Photos › **Restore previous set**, then **Tap to confirm: swap
  sets** (the confirm disappears after 8 s). The previous set becomes active and the active one becomes
  previous in one step. The frame shows it within a minute. Pressing it again swaps back.
- **The /admin line** shows the current and previous sets (photo count and date picked), how many sets
  are queued for cleanup, deletes left today, and storage. New copies record each photo's size. Older
  photos are estimated from the average size (250 KB if none is known), and the figure is then marked
  "approx."
- Health: `photos.cleanup {queued, deletedToday}` is informational. `photos_active_missing` alerts if
  the live set has lost photos.

## Storage

At ~250 KB a photo, a 300-photo set is about 75 MB, so keeping two sets uses about 150 MB of the free
1 GB of KV.

## If Google sign-in for photos breaks

`/api/health` reports `grant_photos_<status>`. `/admin` → Google → **Connect photos**.
