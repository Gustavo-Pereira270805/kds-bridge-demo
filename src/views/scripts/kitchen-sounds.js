(function () {
  'use strict';

  // Motor de sons da cozinha — Web Audio API nativa (sem Tone.js, sem CDN).
  // Portado da prova auditiva aprovada (companion v8): mesma receita, mesmos
  // Hz/tempos/ganhos. ES5 — sem let/const/arrow/template literals.

  var audio = null;
  var master = null;
  var pendingAlert = null;
  var retryTimer = null;
  var retryIndex = 0;
  var RETRY_DELAYS = [1000, 2000, 3000];

  function getContext() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('Web Audio API indisponível neste navegador');
    if (!audio) {
      audio = new Ctx();
      master = audio.createGain();
      var compressor = audio.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.ratio.value = 6;
      master.connect(compressor);
      compressor.connect(audio.destination);
    }
    return audio;
  }

  function resumeContext() {
    if (!audio || audio.state !== 'suspended' || typeof audio.resume !== 'function') return;
    try {
      var p = audio.resume();
      if (p && typeof p.catch === 'function') {
        p.catch(function (e) { console.error('KDS sons: falha ao retomar o áudio:', e); });
      }
    } catch (e) {
      console.error('KDS sons: falha ao retomar o áudio:', e);
    }
  }

  function clearRetryTimer() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  }

  function flushPending() {
    if (!pendingAlert) return;
    if (!audio || audio.state !== 'running') return;
    var fn = pendingAlert;
    pendingAlert = null;
    retryIndex = 0;
    clearRetryTimer();
    try {
      fn();
    } catch (e) {
      console.error('KDS sons: falha ao tocar alerta pendente:', e);
    }
  }

  function scheduleRetry(recipe) {
    pendingAlert = recipe;
    clearRetryTimer();
    if (retryIndex >= RETRY_DELAYS.length) {
      console.error('KDS sons: navegador bloqueou o áudio (autoplay); o alerta tocará no primeiro toque na tela.');
      return;
    }
    var delay = RETRY_DELAYS[retryIndex];
    retryIndex++;
    retryTimer = setTimeout(function () {
      retryTimer = null;
      if (audio && audio.state === 'running') {
        flushPending();
      } else if (pendingAlert) {
        scheduleRetry(pendingAlert);
      }
    }, delay);
  }

  function unlock() {
    resumeContext();
    flushPending();
  }

  function bindGestureUnlock() {
    var events = ['click', 'touchstart', 'keydown'];
    for (var i = 0; i < events.length; i++) {
      document.addEventListener(events[i], unlock);
    }
    // Guia em background fica com o AudioContext suspenso (política do navegador):
    // ao voltar a ficar visível, retomar o contexto e tocar o alerta pendente.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) unlock();
    });
  }

  function play(recipe, name) {
    try {
      var ctx = getContext();
      if (ctx.state === 'suspended') {
        resumeContext();
        scheduleRetry(recipe);
        return;
      }
      clearRetryTimer();
      pendingAlert = null;
      retryIndex = 0;
      recipe();
    } catch (e) {
      console.error('KDS sons: falha ao tocar alerta "' + name + '":', e);
    }
  }

  // Envelope exponencial por vozes: silêncio -> pico em `attack` -> silêncio em `duration`.
  function gainEnvelope(at, attack, peak, duration) {
    var gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    return gain;
  }

  var CRYSTAL_PROFILE = [[1, 1, 1], [2.01, 0.52, 0.58], [2.65, 0.34, 0.42], [3.35, 0.22, 0.3], [4.15, 0.13, 0.22], [5.05, 0.07, 0.16]];

  // Sino de cristal: um oscilador sine por partial, decay próprio por partial.
  function crystalBell(freq, at, duration, volume, profile) {
    var parts = profile || CRYSTAL_PROFILE;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var partialDuration = duration * p[2];
      var osc = audio.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * p[0];
      osc.connect(gainEnvelope(at, 0.003, volume * p[1], partialDuration)).connect(master);
      osc.start(at);
      osc.stop(at + partialDuration + 0.05);
    }
  }

  // Glissando exponencial (sino metálico descendente do stockout).
  function sweptTone(type, startFreq, endFreq, at, duration, volume) {
    var osc = audio.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, at);
    osc.frequency.exponentialRampToValueAtTime(endFreq, at + duration);
    osc.connect(gainEnvelope(at, 0.008, volume, duration)).connect(master);
    osc.start(at);
    osc.stop(at + duration + 0.06);
  }

  // ---- Receitas (prova v8 aprovada — não alterar Hz/tempos/ganhos) ----

  function recipeNormal() {
    var at = audio.currentTime;
    crystalBell(1318, at, 1.15, 0.62);
    crystalBell(1047, at + 0.29, 1.35, 0.62);
  }

  function recipeUrgent() {
    var at = audio.currentTime;
    crystalBell(1318, at, 1.15, 0.85);
    crystalBell(1047, at + 0.22, 1.35, 0.85);
    crystalBell(1318, at + 0.44, 1.15, 0.85);
    crystalBell(1047, at + 0.66, 1.35, 0.85);
  }

  function recipeStockout() {
    var at = audio.currentTime;
    // Produto zerado também vira urgente: primeiro a cadência de urgência completa,
    // logo após (at + 0.9s) o sino metálico descendente + glissando do zerado.
    recipeUrgent();
    var t2 = at + 0.9;
    var descending = [[1, 1, 0.9], [2.01, 0.42, 0.52], [2.65, 0.25, 0.36], [3.35, 0.14, 0.25]];
    crystalBell(659, t2, 1.35, 0.68, descending);
    sweptTone('sine', 659, 370, t2, 1.35, 0.28);
  }

  function recipeCrossCancel() {
    var at = audio.currentTime;
    crystalBell(784, at, 0.9, 0.6);
    crystalBell(659, at + 0.24, 1.0, 0.6);
  }

  window.playNormalAlert = function () { play(recipeNormal, 'novo pedido'); };
  window.playUrgentAlert = function () { play(recipeUrgent, 'urgência'); };
  window.playStockoutAlert = function () { play(recipeStockout, 'stockout'); };
  window.playCrossCancelAlert = function () { play(recipeCrossCancel, 'cross-cancel'); };

  bindGestureUnlock();
})();
