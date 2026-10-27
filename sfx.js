/* ==========================================================================
   sfx.js — tiny sound engine (Web Audio API, no files, no external links)
   Every sound is synthesized in the browser, so it works instantly, offline,
   and never breaks because a hosted audio link went down.

   Public API:
     SFX.click()   short "pop" when a piece is placed
     SFX.win()     rising triumphant arpeggio
     SFX.lose()    sad descending "game over"
     SFX.draw()    neutral two-note chime
     SFX.toggle()  mute / unmute   (remembered in localStorage)
     SFX.muted     current state
   ========================================================================== */
const SFX = (() => {
  'use strict';
  let ctx = null, master = null;
  let muted = false;
  try { muted = localStorage.getItem('ttt-muted') === '1'; } catch (e) {}

  // Browsers only allow audio after a user gesture, so the context is created lazily.
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // One note: oscillator + quick attack / exponential decay envelope.
  function tone({ freq, start = 0, dur = 0.25, type = 'sine', vol = 0.3, slideTo = null }) {
    const c = ensure();
    if (!c || muted) return;
    const t0 = c.currentTime + start;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  const NOTE = { C4: 261.63, E4: 329.63, G4: 392.0, A3: 220.0, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, C6: 1046.5, B4: 493.88, F4: 349.23, D4: 293.66, A4: 440.0 };

  return {
    get muted() { return muted; },

    /* Clean, quick "pop" */
    click() {
      tone({ freq: 620, slideTo: 260, dur: 0.09, type: 'sine', vol: 0.35 });
      tone({ freq: 1240, slideTo: 520, dur: 0.05, type: 'triangle', vol: 0.08 });
    },

    /* Win: bright rising arpeggio ending on a held chord */
    win() {
      [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) =>
        tone({ freq: f, start: i * 0.11, dur: 0.22, type: 'triangle', vol: 0.3 }));
      [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f) =>
        tone({ freq: f, start: 0.5, dur: 0.9, type: 'sine', vol: 0.16 }));
      tone({ freq: NOTE.C6 * 2, start: 0.5, dur: 0.5, type: 'sine', vol: 0.05 }); // sparkle
    },

    /* Lose: slow descending minor figure with a low sliding "wah" */
    lose() {
      [NOTE.A4, NOTE.F4, NOTE.D4, NOTE.A3].forEach((f, i) =>
        tone({ freq: f, start: i * 0.2, dur: 0.3, type: 'sawtooth', vol: 0.16 }));
      tone({ freq: 160, slideTo: 70, start: 0.8, dur: 0.7, type: 'square', vol: 0.12 });
    },

    /* Draw: neutral two-note chime */
    draw() {
      tone({ freq: NOTE.G4, dur: 0.35, type: 'sine', vol: 0.28 });
      tone({ freq: NOTE.C5, start: 0.16, dur: 0.55, type: 'sine', vol: 0.28 });
    },

    toggle() {
      muted = !muted;
      try { localStorage.setItem('ttt-muted', muted ? '1' : '0'); } catch (e) {}
      if (!muted) this.click();
      return muted;
    },

    // Call once on the first user gesture so audio is ready before the first move.
    unlock() { ensure(); },
  };
})();

// Unlock audio on the first interaction (browser autoplay policy).
['pointerdown', 'keydown'].forEach((ev) =>
  addEventListener(ev, () => SFX.unlock(), { once: true, passive: true }));