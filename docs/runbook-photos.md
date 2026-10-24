# Runbook: pick a new photo set

Photos come from Google Photos through the Picker API (Stephen's personal Google account). Up to 300
per set, shown for 60 seconds each in shuffled order, with a small date caption.

1. On a phone or computer (not the frame), open `/admin` → Photos → **Pick new photos**.
2. Google's picker opens. Choose up to 300 photos and press Done.
3. Keep `/admin` open (or reopen it later; it resumes). It copies photos in batches of 20 and shows progress. The frame keeps showing
   the old set until the new one is complete, then switches over in one step.

## Limits (Workers Free plan)

- Each photo is one KV write, and KV allows 1,000 writes a day. The Worker keeps its own budget of
  900 a day (UTC). A new set is refused if it would exceed today's budget. A copy that hits the budget
  pauses; open `/admin` again after midnight UTC (6 PM Denver in MDT, 5 PM in MST) and it picks up
  where it stopped.
- At most one new 300-photo set per day.

## Storage

Old sets are retired, not deleted (deletes count against a separate 1,000/day limit, and nothing is
deleted automatically). At ~250 KB a photo, a 300-photo set is about 75 MB, so the free 1 GB of KV
holds about 13 sets. A manual purge of retired sets is a possible later admin action.

## If Google sign-in for photos breaks

`/api/health` reports `grant_photos_<status>`. `/admin` → Google → **Connect photos**.
