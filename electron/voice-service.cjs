const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function resolveVoiceAsset(filename) {
  const unpacked = path.join(__dirname, 'voice', filename).replace('app.asar', 'app.asar.unpacked');
  if (fs.existsSync(unpacked)) return unpacked;
  return path.join(__dirname, 'voice', filename);
}

function createVoiceService(ipcMain, getWindow) {
  let proc = null;
  let lineBuf = '';

  function send(payload) {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('voice:event', payload);
    }
  }

  function stop() {
    if (proc) {
      try { proc.kill('SIGTERM'); } catch {}
      proc = null;
    }
    lineBuf = '';
  }

  function start() {
    stop();

    let cmd;
    let args;

    if (process.platform === 'darwin') {
      const bin = resolveVoiceAsset('mac-speech');
      if (!fs.existsSync(bin)) {
        send({ error: 'macOS voice helper not compiled (run npm run build:voice:mac)' });
        return;
      }
      cmd = bin;
      args = [];
    } else if (process.platform === 'win32') {
      const script = resolveVoiceAsset('win-speech.ps1');
      if (!fs.existsSync(script)) {
        send({ error: 'Windows voice script missing' });
        return;
      }
      cmd = 'powershell.exe';
      args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script];
    } else {
      send({ error: 'Native voice control is supported on macOS and Windows' });
      return;
    }

    try {
      proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      send({ error: err.message });
      return;
    }

    const current = proc;

    current.stdout.on('data', (chunk) => {
      lineBuf += chunk.toString('utf8');
      let nl;
      while ((nl = lineBuf.indexOf('\n')) !== -1) {
        const line = lineBuf.slice(0, nl).trim();
        lineBuf = lineBuf.slice(nl + 1);
        if (!line) continue;
        try {
          send(JSON.parse(line));
        } catch {}
      }
    });

    current.on('exit', (code) => {
      if (proc === current) {
        proc = null;
        if (code && code !== 0) {
          send({ status: 'stopped' });
        }
      }
    });

    current.on('error', (err) => {
      if (proc === current) {
        proc = null;
        send({ error: err.message });
      }
    });
  }

  ipcMain.on('voice:start', start);
  ipcMain.on('voice:stop', stop);

  return { stop };
}

module.exports = { createVoiceService };
