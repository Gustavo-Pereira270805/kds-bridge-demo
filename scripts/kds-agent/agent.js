// scripts/kds-agent/agent.js
import { io } from 'socket.io-client';
import { exec } from 'child_process';
import os from 'os';
const SERVER = process.env.KDS_SERVER || 'https://kds-framboa.duckdns.org';
const TOKEN = process.env.KDS_TOKEN || '';
const socket = io(SERVER, {auth:{token: TOKEN}});
const hostname = os.hostname(); // kds-quente-1 / kds-fria-1
socket.on('connect', ()=>{ socket.emit('join','kds-pis'); console.log('kds-agent conectado', hostname); });
setInterval(()=> socket.emit('pi:heartbeat', {hostname, at: new Date().toISOString()}), 30000);
socket.on('pi:power', ({target, action})=>{
  const suffix = hostname.includes('quente') ? 'quente' : hostname.includes('fria') ? 'fria' : '';
  if (target !== 'ambos' && target !== suffix) return;
  const cmd = action==='shutdown' ? 'sudo /sbin/poweroff' : 'sudo /sbin/reboot';
  exec(cmd, (err)=> console.log(err?`erro ${err.message}`:`exec ${cmd}`));
});
