/**
 * ============================================================================
 *  notifications.js — Sesli alarm (Web Audio) + Tarayıcı bildirimi (Notification)
 *  ----------------------------------------------------------------------------
 *  - AlarmSound: harici ses dosyası GEREKTİRMEDEN, Web Audio ile siren üretir.
 *    Tarayıcı otomatik oynatmayı engellediği için ilk kullanıcı etkileşiminde
 *    (tıklama) AudioContext açılır.
 *  - BrowserNotify: kullanıcı izniyle masaüstü bildirimi gönderir.
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/*  Sesli alarm — Web Audio API ile siren                                     */
/* -------------------------------------------------------------------------- */
class AlarmSound {
  constructor() {
    this.ctx = null;
    this.osc = null;
    this.gain = null;
    this.lfo = null;       // siren "iniş-çıkış" efekti için
    this.lfoGain = null;
    this.playing = false;
    this.volume = (window.CONFIG?.defaults.soundVolume) ?? 0.7;
    this.enabled = (window.CONFIG?.defaults.soundEnabled) ?? true;
  }

  /** AudioContext'i (ilk kullanıcı etkileşiminde) hazırlar/devam ettirir. */
  _ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** Tarayıcı otomatik-oynatma kilidini açmak için sayfa açılışında çağrılır. */
  unlock() {
    try { this._ensureContext(); } catch (_) { /* yok say */ }
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gain && this.playing) {
      this.gain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.stop();
  }

  /** Sireni başlatır (zaten çalıyorsa veya kapalıysa hiçbir şey yapmaz). */
  start() {
    if (!this.enabled || this.playing) return;
    try {
      this._ensureContext();
      const now = this.ctx.currentTime;

      this.osc = this.ctx.createOscillator();
      this.osc.type = 'sawtooth';
      this.osc.frequency.value = 720;

      // Siren etkisi: frekansı LFO ile yukarı-aşağı süpür
      this.lfo = this.ctx.createOscillator();
      this.lfo.type = 'sine';
      this.lfo.frequency.value = 3; // saniyede ~3 süpürme
      this.lfoGain = this.ctx.createGain();
      this.lfoGain.gain.value = 260; // frekans sapması (Hz)
      this.lfo.connect(this.lfoGain).connect(this.osc.frequency);

      this.gain = this.ctx.createGain();
      this.gain.gain.setValueAtTime(0, now);
      this.gain.gain.linearRampToValueAtTime(this.volume, now + 0.08);

      this.osc.connect(this.gain).connect(this.ctx.destination);
      this.osc.start();
      this.lfo.start();
      this.playing = true;
    } catch (e) {
      console.warn('[AlarmSound] başlatılamadı:', e);
    }
  }

  /** Sireni durdurur. */
  stop() {
    if (!this.playing) return;
    try {
      const now = this.ctx.currentTime;
      this.gain.gain.setTargetAtTime(0, now, 0.05);
      this.osc.stop(now + 0.2);
      this.lfo.stop(now + 0.2);
    } catch (_) { /* yok say */ }
    this.playing = false;
    this.osc = this.lfo = this.gain = this.lfoGain = null;
  }

  /** Kısa bir "bip" — komut geri bildirimi vb. için (alarm değil). */
  beep(freq = 880, ms = 120) {
    if (!this.enabled) return;
    try {
      this._ensureContext();
      const now = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(this.volume * 0.5, now + 0.01);
      g.gain.setTargetAtTime(0, now + ms / 1000, 0.05);
      o.connect(g).connect(this.ctx.destination);
      o.start();
      o.stop(now + ms / 1000 + 0.2);
    } catch (_) { /* yok say */ }
  }
}

/* -------------------------------------------------------------------------- */
/*  Tarayıcı bildirimi (Notification API)                                     */
/* -------------------------------------------------------------------------- */
const BrowserNotify = {
  /** İzin durumu: 'default' | 'granted' | 'denied' | 'unsupported' */
  status() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  },

  /** Kullanıcıdan izin ister, sonuç döndürür. */
  async request() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    try {
      return await Notification.requestPermission();
    } catch (_) {
      return Notification.permission;
    }
  },

  /** İzin varsa bildirim gönderir. */
  notify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification(title, {
        body,
        icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23ef4444"%3E%3Cpath d="M12 2c1 3 4 4 4 8a4 4 0 1 1-8 0c0-1 .5-2 1-3 .5 2 2 2 2 0 0-2-1-3 1-5Z"/%3E%3C/svg%3E',
        tag: 'flare-alarm', // aynı etikette üst üste yığılmaz
        requireInteraction: false,
      });
    } catch (e) {
      console.warn('[BrowserNotify] gönderilemedi:', e);
    }
  },
};

window.AlarmSound = AlarmSound;
window.BrowserNotify = BrowserNotify;
