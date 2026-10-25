// The alert chime (PLAN-v2.md §9.3): one bundled WAV through an <audio> element, no Web Audio.
// The Home HQ kiosk allows playback without a gesture. If play() is refused anyway (an older kiosk
// build), the chime is kept pending and plays on the next tap; with nothing pending, that tap just
// unlocks audio with a silent play.

export function createChime(src, opts) {
  const o = opts || {};
  const make = o.make || (() => new Audio(src));
  const onState = o.onState || (() => {});
  let audio = null;
  let blocked = false;
  let pending = null; // volume of a chime that couldn't play

  function el() {
    if (!audio) {
      audio = make();
      audio.preload = 'auto';
    }
    return audio;
  }

  function play(volumePct, silent) {
    const a = el();
    try {
      a.pause();
      a.currentTime = 0;
    } catch {
      // ignore
    }
    a.muted = !!silent;
    a.volume = Math.max(0, Math.min(1, volumePct / 100));
    let p;
    try {
      p = a.play();
    } catch (e) {
      p = Promise.reject(e);
    }
    return Promise.resolve(p).then(
      () => {
        blocked = false;
        if (!silent) pending = null;
        onState('ok');
        return true;
      },
      () => {
        blocked = true;
        if (!silent) pending = volumePct;
        onState('blocked');
        return false;
      },
    );
  }

  return {
    play: (volumePct) => play(volumePct, false),
    /** Call on every tap: plays a chime that was refused, or unlocks audio. */
    onTap() {
      if (!blocked) return;
      if (pending !== null) play(pending, false);
      else play(0, true);
    },
    /** Forget a pending chime (its alert ended or was dismissed). */
    drop() {
      pending = null;
    },
    isBlocked: () => blocked,
    hasPending: () => pending !== null,
  };
}
