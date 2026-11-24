// Web Bluetooth Smart Trainer support (Cycling Power 0x1818 + FTMS 0x1826)
// Works in both Electron (via window.electronBluetooth picker) and Chrome/Edge.

const FTMS_SERVICE = 0x1826;
const FTMS_CONTROL_POINT = 0x2ad9;
const OP_REQUEST_CONTROL = 0x00;
const OP_SET_SIM_PARAMS = 0x11;
const OP_RESPONSE = 0x80;
const RESULT_SUCCESS = 0x01;

const HILLS_KEY = 'golden-hour-riding-hills';
const TRAINER_KEY = 'golden-hour-riding-trainer';

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Bluetooth operation timed out')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

function buildSimParams(gradePct) {
  const view = new DataView(new ArrayBuffer(7));
  view.setUint8(0, OP_SET_SIM_PARAMS);
  view.setInt16(1, 0, true); // wind speed (0.001 m/s)
  view.setInt16(3, Math.round(gradePct * 100), true); // grade (0.01 %)
  view.setUint8(5, Math.round(0.004 / 0.0001)); // Crr (0.0001)
  view.setUint8(6, Math.round((0.5 * 1.2 * 0.32) / 0.01)); // Cw (0.01 kg/m)
  return view;
}

function ftmsRequest(controlPoint, bytes) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      controlPoint.removeEventListener('characteristicvaluechanged', onReply);
    };
    const onReply = (e) => {
      const d = e.target.value;
      if (d.byteLength < 3 || d.getUint8(0) !== OP_RESPONSE || d.getUint8(1) !== bytes[0]) return;
      cleanup();
      if (d.getUint8(2) === RESULT_SUCCESS) resolve();
      else reject(new Error('Trainer refused FTMS command'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('No FTMS reply from trainer'));
    }, 3000);
    controlPoint.addEventListener('characteristicvaluechanged', onReply);
    controlPoint.writeValueWithResponse(Uint8Array.from(bytes)).catch((err) => {
      cleanup();
      reject(err);
    });
  });
}

export function createTrainerController({
  btButton,
  hillsDownBtn,
  hillsUpBtn,
  hillsLabel,
  btModal,
  btDeviceList,
  btCancelBtn,
  onPower,
  getGrade,
  onConnectedChange,
}) {
  let hillsScale = (() => {
    const q = new URLSearchParams(window.location.search).get('hills');
    let pct = 50;
    try {
      const saved = localStorage.getItem(HILLS_KEY);
      if (saved !== null && Number.isFinite(+saved)) pct = +saved;
    } catch {}
    if (q !== null && q !== '' && Number.isFinite(+q)) pct = +q;
    return Math.max(0, Math.min(100, pct)) / 100;
  })();

  const bike = {
    dev: null,
    known: null,
    controlPoint: null,
    busy: false,
    busyJoin: false,
    lastSentGrade: 0,
    lastSentAt: 0,
    fails: 0,
    timer: 0,
    tries: 0,
  };
  const watched = new WeakSet();

  // Wire up Electron's in-app Bluetooth device picker modal if running in Electron
  if (window.electronBluetooth && btModal && btDeviceList && btCancelBtn) {
    window.electronBluetooth.onDeviceList((devices) => {
      btDeviceList.innerHTML = '';
      if (!devices.length) {
        const li = document.createElement('li');
        li.textContent = 'Searching… make sure your trainer is awake and not paired elsewhere.';
        li.style.opacity = '0.7';
        li.style.fontSize = '12px';
        btDeviceList.append(li);
      } else {
        for (const d of devices) {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = d.deviceName;
          btn.addEventListener('click', () => {
            btModal.close();
            window.electronBluetooth.selectDevice(d.deviceId);
          });
          li.append(btn);
          btDeviceList.append(li);
        }
      }
      if (!btModal.open) btModal.showModal();
    });

    const cancelScan = () => {
      if (btModal.open) btModal.close();
      window.electronBluetooth.selectDevice('');
    };
    btCancelBtn.addEventListener('click', cancelScan);
    btModal.addEventListener('cancel', (e) => {
      e.preventDefault();
      cancelScan();
    });
  }

  function getLastTrainer() {
    try {
      return JSON.parse(localStorage.getItem(TRAINER_KEY)) || null;
    } catch {
      return null;
    }
  }

  function updateButtonLabel() {
    const last = getLastTrainer();
    if (bike.dev) {
      btButton.textContent = bike.controlPoint ? 'Trainer: power & gradient' : 'Trainer: power only';
      btButton.classList.add('on');
    } else {
      btButton.classList.remove('on');
      const canReconnect = Boolean(bike.known || (last && navigator.bluetooth && navigator.bluetooth.getDevices));
      btButton.textContent = canReconnect ? 'Reconnect trainer' : 'Connect trainer';
    }
  }

  function setHills(pct) {
    hillsScale = Math.max(0, Math.min(100, Math.round(pct / 10) * 10)) / 100;
    try {
      localStorage.setItem(HILLS_KEY, String(Math.round(hillsScale * 100)));
    } catch {}
    hillsLabel.textContent = hillsScale ? `Hills ${Math.round(hillsScale * 100)} %` : 'Hills off';
    bike.lastSentAt = 0;
  }

  async function sendGrade() {
    const grade = getGrade();
    const scaled = Math.max(-20, Math.min(20, grade)) * (grade > 0 ? hillsScale : hillsScale * 0.5);
    const now = performance.now();
    const elapsed = now - bike.lastSentAt;
    if (!bike.controlPoint || bike.busy || elapsed < 250 || (elapsed < 1000 && Math.abs(scaled - bike.lastSentGrade) <= 0.5)) {
      return;
    }
    bike.busy = true;
    bike.lastSentAt = now;
    const cp = bike.controlPoint;
    try {
      await cp.writeValueWithResponse(buildSimParams(scaled));
      bike.lastSentGrade = scaled;
      bike.fails = 0;
    } catch {
      if (bike.controlPoint === cp && ++bike.fails >= 3) {
        bike.controlPoint = null;
        clearInterval(bike.timer);
        updateButtonLabel();
      }
    }
    bike.busy = false;
  }

  async function startFtms(server) {
    try {
      const svc = await server.getPrimaryService(FTMS_SERVICE);
      const cp = await svc.getCharacteristic(FTMS_CONTROL_POINT);
      await cp.startNotifications();
      await ftmsRequest(cp, [OP_REQUEST_CONTROL]);
      Object.assign(bike, { controlPoint: cp, busy: false, lastSentGrade: 0, lastSentAt: 0, fails: 0 });
      bike.timer = setInterval(sendGrade, 250);
    } catch {
      bike.controlPoint = null;
    }
  }

  async function connectDevice(dev) {
    let server;
    try {
      server = await withTimeout(dev.gatt.connect(), 8000);
    } catch (err) {
      try { dev.gatt.disconnect(); } catch {}
      throw err;
    }
    const powerSvc = await server.getPrimaryService('cycling_power');
    const powerChar = await powerSvc.getCharacteristic('cycling_power_measurement');
    await powerChar.startNotifications();
    powerChar.addEventListener('characteristicvaluechanged', (e) => {
      onConnectedChange(true);
      onPower(e.target.value.getInt16(2, true));
    });

    if (!watched.has(dev)) {
      watched.add(dev);
      dev.addEventListener('gattserverdisconnected', () => {
        onConnectedChange(false);
        clearInterval(bike.timer);
        bike.dev = null;
        bike.controlPoint = null;
        updateButtonLabel();
        rejoin(dev);
      });
    }

    bike.dev = dev;
    bike.known = dev;
    bike.tries = 0;
    btButton.title = dev.name || '';
    try {
      localStorage.setItem(TRAINER_KEY, JSON.stringify({ id: dev.id, name: dev.name || '' }));
    } catch {}
    await startFtms(server);
    if (dev.gatt.connected) updateButtonLabel();
  }

  async function rejoin(dev) {
    while (!bike.dev && bike.known === dev && bike.tries < 6) {
      bike.tries++;
      btButton.textContent = 'Reconnecting…';
      await new Promise((r) => setTimeout(r, 2500));
      if (bike.dev || bike.known !== dev) return;
      try {
        await connectDevice(dev);
        return;
      } catch {
        clearInterval(bike.timer);
        bike.dev = null;
        bike.controlPoint = null;
      }
    }
    updateButtonLabel();
  }

  async function getKnownDevices() {
    const list = bike.known ? [bike.known] : [];
    const last = getLastTrainer();
    if (navigator.bluetooth && navigator.bluetooth.getDevices) {
      try {
        for (const d of await navigator.bluetooth.getDevices()) {
          if (!list.includes(d)) {
            if (last && d.id === last.id) list.unshift(d);
            else list.push(d);
          }
        }
      } catch {}
    }
    return list;
  }

  btButton.addEventListener('click', async () => {
    if (!navigator.bluetooth) {
      btButton.textContent = 'Bluetooth unavailable';
      return;
    }
    if (bike.busyJoin) return;
    bike.busyJoin = true;
    bike.tries = 99;
    try {
      if (!bike.dev) {
        for (const dev of await getKnownDevices()) {
          btButton.textContent = 'Reconnecting…';
          try {
            await connectDevice(dev);
            return;
          } catch {
            clearInterval(bike.timer);
            bike.dev = null;
            bike.controlPoint = null;
          }
        }
      }
      updateButtonLabel();
      const dev = await navigator.bluetooth.requestDevice({
        filters: [{ services: ['cycling_power'] }, { services: [FTMS_SERVICE] }],
        optionalServices: ['cycling_power', FTMS_SERVICE],
      });
      btButton.textContent = 'Connecting…';
      if (bike.dev && bike.dev !== dev) {
        const old = bike.dev;
        bike.known = dev;
        try { old.gatt.disconnect(); } catch {}
      }
      await connectDevice(dev);
    } catch {
      if (!bike.dev) {
        clearInterval(bike.timer);
        bike.controlPoint = null;
      }
      updateButtonLabel();
    } finally {
      bike.busyJoin = false;
    }
  });

  hillsDownBtn.addEventListener('click', () => setHills(hillsScale * 100 - 10));
  hillsUpBtn.addEventListener('click', () => setHills(hillsScale * 100 + 10));

  updateButtonLabel();
  setHills(hillsScale * 100);

  return {
    setHills,
    getHillsPercent: () => Math.round(hillsScale * 100),
    getHillsLabel: () => hillsLabel.textContent,
  };
}
