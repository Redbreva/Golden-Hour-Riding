// Optional Web Speech API voice commands

export function initVoiceControl({
  button,
  winterMode,
  setWeather,
  skipDistance,
  setCleanMode,
  adjustHills,
  setHills,
  getHillsLabel,
}) {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const commands = [
    [/\b(easier|easy|lighter|less|ease|gear down|shift down|change down|lower gear|down a gear)\b/, getHillsLabel, () => adjustHills(-20)],
    [/\b(harder|hard|heavier|more|tougher|gear up|shift up|change up|higher gear|up a gear)\b/, getHillsLabel, () => adjustHills(20)],
    [/\b(flat|no hills|hills off)\b/, getHillsLabel, () => setHills(0)],
    [/\b(full|real hills|all of it)\b/, getHillsLabel, () => setHills(100)],
    ...(winterMode ? [[/\b(snow|snowing|snowy|christmas)\b/, 'Snow', () => setWeather('snow')]] : []),
    [/\b(rain|raining|rainy|storm|wet)\b/, 'Rain', () => setWeather('rain')],
    [/\b(mist|misty|fog|foggy)\b/, 'Mist', () => setWeather('mist')],
    [/\b(overcast|cloud|clouds|cloudy|grey|gray)\b/, 'Overcast', () => setWeather('overcast')],
    [/\b(golden|sun|sunny|sunshine|sunset|clear|evening)\b/, 'Golden', () => setWeather('golden')],
    [/\b(starry|stars|night|painting|van gogh)\b/, 'Starry', () => setWeather('starry')],
    [/\b(skip|forward|ahead)\b/, 'Skip ahead', () => skipDistance(250)],
    [/\bback\b/, 'Skip back', () => skipDistance(-250)],
    [/\b(hide|hidden)\b/, 'Info hidden', () => setCleanMode(true)],
    [/\b(show|info|display)\b/, 'Info shown', () => setCleanMode(false)],
  ];

  let rec = null;
  let active = false;
  let lastHandled = 0;

  const setLabel = (text) => {
    button.textContent = text;
    button.classList.toggle('on', active);
  };

  if (window.electronBluetooth) {
    button.title = 'Web Speech API is not supported in Electron (use Chrome/Edge via npm run dev, or an offline speech engine in a future stage)';
    button.addEventListener('click', () => setLabel('Voice: Chrome/Edge only'));
    return;
  }

  if (!SpeechRec) {
    button.title = 'Voice control requires Chrome or Edge';
    button.addEventListener('click', () => setLabel('Voice: Chrome/Edge only'));
    return;
  }

  button.addEventListener('click', () => {
    if (active) {
      active = false;
      rec?.stop();
      setLabel('Voice: off');
      return;
    }
    rec = new SpeechRec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-GB';
    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript.toLowerCase();
        const match = commands.find(([rx]) => rx.test(transcript));
        if (match && performance.now() - lastHandled > 2500) {
          lastHandled = performance.now();
          match[2]();
          const feedback = typeof match[1] === 'function' ? match[1]() : match[1];
          setLabel(`Voice: ${feedback}`);
        }
      }
    };
    rec.onend = () => {
      if (active) {
        try { rec.start(); } catch {}
      }
    };
    rec.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        active = false;
        setLabel('Voice: blocked');
      } else if (event.error === 'network' || event.error === 'audio-capture') {
        active = false;
        setLabel('Voice: unavailable');
      }
    };
    active = true;
    rec.start();
    setLabel('Voice: listening');
  });
}
