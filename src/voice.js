// Native OS offline voice control (macOS SFSpeechRecognizer / Windows System.Speech)

export function initVoiceControl({
  button,
  winterMode,
  setWeather,
  skipDistance,
  setCleanMode,
  setMuted,
  setHeadlight,
  adjustHills,
  setHills,
  getHillsLabel,
}) {
  const voiceApi = window.electronVoice;
  const commands = [
    [/\b(easier|easy|lighter|less|ease|gear down|shift down|change down|lower gear|down a gear)\b/, getHillsLabel, () => adjustHills(-20)],
    [/\b(harder|hard|heavier|more|tougher|gear up|shift up|change up|higher gear|up a gear)\b/, getHillsLabel, () => adjustHills(20)],
    [/\b(flat|flatter|no hills|hills off)\b/, getHillsLabel, () => setHills(0)],
    [/\b(full|real hills|all of it)\b/, getHillsLabel, () => setHills(100)],
    ...(winterMode ? [[/\b(snow|snowing|snowy|christmas)\b/, 'Snow', () => setWeather('snow')]] : []),
    [/\b(rain|reign|rayne|raining|rainy|storm|wet)\b/, 'Rain', () => setWeather('rain')],
    [/\b(mist|missed|misty|fog|foggy)\b/, 'Mist', () => setWeather('mist')],
    [/\b(overcast|over cast|cloud|clouds|cloudy|grey|gray)\b/, 'Overcast', () => setWeather('overcast')],
    [/\b(sunset|dusk|deep sunset)\b/, 'Deep Sunset', () => setWeather('sunset')],
    [/\b(golden|gold|sun|sunny|sunshine|clear|evening)\b/, 'Golden', () => setWeather('golden')],
    [/\b(starry|story|stars|night|painting|van gogh)\b/, 'Starry', () => setWeather('starry')],
    [/\b(skip|forward|ahead)\b/, 'Skip ahead', () => skipDistance(250)],
    [/\b(back|go back)\b/, 'Skip back', () => skipDistance(-250)],
    [/\b(hide|hyde|hidden)\b/, 'Info hidden', () => setCleanMode(true)],
    [/\b(show|info|display)\b/, 'Info shown', () => setCleanMode(false)],
    [/\b(light on|lights on|headlight on|headlight)\b/, 'Light ON', () => setHeadlight(true)],
    [/\b(light off|lights off|headlight off)\b/, 'Light off', () => setHeadlight(false)],
    [/\b(mute|sound off|quiet|silent)\b/, 'Muted', () => setMuted(true)],
    [/\b(unmute|sound on)\b/, 'Sound on', () => setMuted(false)],
  ];

  let active = false;
  let lastHandled = 0;
  let lastCmdKey = '';

  const setLabel = (text) => {
    button.textContent = text;
    button.classList.toggle('on', active);
  };

  if (!voiceApi) {
    button.title = 'Native voice control is unavailable';
    button.addEventListener('click', () => setLabel('Voice: unavailable'));
    return;
  }

  voiceApi.onEvent((payload) => {
    if (!active) return;

    if (payload.error) {
      active = false;
      setLabel(`Voice: ${payload.error}`);
      return;
    }

    if (payload.status === 'listening') {
      setLabel('Voice: listening');
      return;
    }

    if (payload.status === 'stopped') {
      active = false;
      setLabel('Voice: off');
      return;
    }

    if (payload.transcript) {
      const heard = payload.transcript.toLowerCase();
      button.title = `Last heard: "${payload.transcript}"`;
      const match = commands.find(([rx]) => rx.test(heard));
      if (match) {
        const now = performance.now();
        const key = String(match[0]);
        // Allow different commands rapidly (700ms), throttle identical repeats (1600ms)
        const cooldown = key === lastCmdKey ? 1600 : 700;
        if (now - lastHandled > cooldown) {
          lastHandled = now;
          lastCmdKey = key;
          match[2]();
          const feedback = typeof match[1] === 'function' ? match[1]() : match[1];
          setLabel(`Voice: ${feedback}`);
        }
      }
    }
  });

  button.addEventListener('click', () => {
    if (active) {
      active = false;
      voiceApi.stop();
      setLabel('Voice: off');
      return;
    }
    active = true;
    setLabel('Voice: starting…');
    voiceApi.start();
  });

  window.addEventListener('beforeunload', () => {
    if (active) voiceApi.stop();
  });
}
