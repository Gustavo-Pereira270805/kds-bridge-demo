// scripts/kds-agent/agent.js
import { io } from 'socket.io-client';
import { exec } from 'child_process';
import os from 'os';
const SERVER = process.env.KDS_SERVER || 'https://kds-framboa.duckdns.org';
const TOKEN = process.env.KDS_TOKEN || '';
const RECONNECT_MS = 3000;
const HEARTBEAT_MS = 10000;
const hostname = os.hostname(); // kds-quente-1 / kds-fria-1
const suffix = hostname.includes('quente') ? 'quente' : hostname.includes('fria') ? 'fria' : '';
function makeSocket() {
  const s = io(SERVER, { auth:{ token: TOKEN }, reconnection: true, reconnectionDelay: RECONNECT_MS, transports: ['websocket','polling'] });
  s.on('connect', () => {
    console.log(`[kds-agent] conectado ${hostname} id=${s.id} -> ${SERVER}`);
    s.emit('join','kds-pis');
    // heartbeat imediato + interval
    const hb = () => s.emit('pi:heartbeat', { hostname, at: new Date().toISOString() });
    hb();
    if (s._hb) clearInterval(s._hb);
    s._hb = setInterval(hb, HEARTBEAT_MS);
  });
  s.on('disconnect', (reason) => { console.log(`[kds-agent] desconectado ${hostname}: ${reason}`); if (s._hb) clearInterval(s._hb); });
  s.on('connect_error', (err) => console.log(`[kds-agent] connect_error ${hostname}: ${err.message}`));
  s.on('pi:power', ({target, action})=>{
    console.log(`[kds-agent] pi:power recebido target=${target} action=${action} suffix=${suffix}`);
    if (target !== 'ambos' && target !== suffix) { console.log('[kds-agent] ignorado (target mismatch)'); return; }
    const cmd = action==='shutdown' ? 'sudo /sbin/poweroff' : 'sudo /sbin/reboot';
    console.log(`[kds-agent] executando ${cmd}`);
    exec(cmd, (err, stdout, stderr) => {
      if (err) console.log(`[kds-agent] erro ${err.message} stdout=${stdout} stderr=${stderr}`);
      else console.log(`[kds-agent] exec OK ${cmd}`);
    });
  });
  return s;
}
let socket = makeSocket();
