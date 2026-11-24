// Procedural Web Audio soundscape: wind, tyre hum, and rain hiss
// Only plays when the app window has focus (and is not manually muted).

export function createAudioEngine() {
  let ctx = null;
  let master = null;
  let channels = null;
  let focused = document.hasFocus();
  let muted = false;

  function applyMasterGain() {
    if (!ctx || !master) return;
    const target = focused && !muted ? 1 : 0;
    master.gain.setTargetAtTime(target, ctx.currentTime, 0.12);
  }

  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      applyMasterGain();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = focused && !muted ? 1 : 0;
    master.connect(ctx.destination);

    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const makeChannel = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(master);
      src.start();
      return { filter, gain };
    };

    channels = {
      wind: makeChannel('bandpass', 500, 0.5),
      tyre: makeChannel('lowpass', 240, 0.8),
      rain: makeChannel('highpass', 2600, 0.5),
    };
  }

  function setFocused(isFocused) {
    focused = Boolean(isFocused);
    applyMasterGain();
  }

  function setMuted(isMuted) {
    muted = Boolean(isMuted);
    applyMasterGain();
  }

  function isMuted() {
    return muted;
  }

  function update(speedMs, rainAmount) {
    if (!ctx || !channels) return;
    const t = ctx.currentTime;
    channels.wind.gain.gain.setTargetAtTime(Math.min(0.5, ((speedMs * speedMs) / 400) * 0.35), t, 0.2);
    channels.wind.filter.frequency.setTargetAtTime(300 + speedMs * 40, t, 0.2);
    channels.tyre.gain.gain.setTargetAtTime(Math.min(0.35, (speedMs / 15) * 0.25), t, 0.2);
    channels.rain.gain.gain.setTargetAtTime(rainAmount * 0.1, t, 0.4);
  }

  return { unlock, setFocused, setMuted, isMuted, update };
}
