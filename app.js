// Interval Timer PWA — version 9
// 1 page • FR • Offline • Bips (option) • Alerte 3..2..1 (option) • Wake Lock
// UI: un seul bouton ⏯ Pause / reprendre (ne change pas de texte)
// Fin des intervalles: afficher ⏯ puis Terminer
// Terminer: stoppe le chrono principal, affiche uniquement le récap + Nouvelle séance

(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const ui = {
    // Sections
    setup: $('setup'),
    timer: $('timer'),
    errors: $('errors'),
    recap: $('recap'),
    wakeHint: $('wakeHint'),

    // Inputs
    warmupOn: $('warmupOn'),
    work: $('work'),
    rest: $('rest'),
    rounds: $('rounds'),
    countdown: $('countdown'),
    beepOn: $('beepOn'),
    count321: $('count321'),
    plannedTotal: $('plannedTotal'),

    // Timer UI
    sessionClock: $('sessionClock'),
    state: $('state'),
    roundInfo: $('roundInfo'),
    time: $('time'),
    bar: $('bar'),
    totalPlanned: $('totalPlanned'),
    totalRemaining: $('totalRemaining'),

    // Buttons
    startBtn: $('startBtn'),
    beginWorkoutBtn: $('beginWorkoutBtn'),
    toggleBtn: $('toggleBtn'),
    skipBtn: $('skipBtn'),
    stopBtn: $('stopBtn'),
    endNowBtn: $('endNowBtn'),
    endBtn: $('endBtn'),
    newSessionBtn: $('newSessionBtn'),
  };

  // --- Helpers
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtMs = (ms) => {
    ms = Math.max(0, ms);
    const s = Math.round(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${pad2(m)}:${pad2(r)}`;
  };
  function clampInt(v, min, max){
    const n = Math.floor(Number(v));
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  }
  function escapeHtml(str){
    return String(str).replace(/[&<>\"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[s]));
  }
  function setErrors(list){
    if (!list.length){
      ui.errors.hidden = true;
      ui.errors.textContent = '';
      return;
    }
    ui.errors.hidden = false;
    ui.errors.innerHTML = '<ul>' + list.map(x => `<li>${escapeHtml(x)}</li>`).join('') + '</ul>';
  }
  function clearRecap(){
    ui.recap.hidden = true;
    ui.recap.innerHTML = '';
  }

  // --- Offline (service worker)
  if ('serviceWorker' in navigator){
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }

  // --- Audio (beep)
  let audioCtx = null;
  function ensureAudio(){
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!audioCtx) audioCtx = new AC();
    return true;
  }
  function beep(freq=880, duration=0.07, volume=0.18){
    if (!ui.beepOn.checked) return true;
    if (!audioCtx) return false;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + duration);
    return true;
  }
  function beepMulti(pattern){
    if (!ui.beepOn.checked) return true;
    if (!audioCtx) return false;
    const base = audioCtx.currentTime;
    for (const p of pattern){
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = p.freq;
      gain.gain.value = p.vol ?? 0.18;
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(base + (p.delay ?? 0));
      osc.stop(base + (p.delay ?? 0) + (p.dur ?? 0.07));
    }
    return true;
  }

  // --- Wake Lock
  let wakeLock = null;
  async function acquireWakeLock(){
    try{
      if ('wakeLock' in navigator && navigator.wakeLock.request){
        wakeLock = await navigator.wakeLock.request('screen');
        ui.wakeHint.hidden = true;
      }else{
        ui.wakeHint.hidden = false;
      }
    }catch{
      ui.wakeHint.hidden = false;
      wakeLock = null;
    }
  }
  async function releaseWakeLock(){
    try{ if (wakeLock) await wakeLock.release(); }catch{}
    wakeLock = null;
  }
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && session.status !== 'idle'){
      await acquireWakeLock();
    }
  });

  // --- Config & planned time
  function getConfig(){
    return {
      warmupOn: !!ui.warmupOn.checked,
      departSec: clampInt(ui.countdown.value, 3, 10),
      travailSec: clampInt(ui.work.value, 1, 3600),
      pauseSec: clampInt(ui.rest.value, 0, 3600),
      series: clampInt(ui.rounds.value, 1, 999),
    };
  }
  function validateConfig(c){
    const errs = [];
    if (c.travailSec < 1) errs.push('Travail doit être ≥ 1 seconde.');
    if (c.pauseSec < 0) errs.push('Pause doit être ≥ 0.');
    if (c.series < 1) errs.push('Séries doit être ≥ 1.');
    if (c.departSec < 3 || c.departSec > 10) errs.push('Compte à rebours départ doit être entre 3 et 10 secondes.');
    return errs;
  }
  function computePlannedTotal(){
    const c = getConfig();
    const plannedMs =
      (c.departSec) * 1000 +
      (c.series * c.travailSec) * 1000 +
      (Math.max(0, c.series - 1) * c.pauseSec) * 1000;
    ui.plannedTotal.textContent = fmtMs(plannedMs);
    return plannedMs;
  }

  // --- Session clock
  const session = {
    status: 'idle', // idle | warmup | running | paused | finished | recap
    startMono: 0,
    elapsedMs: 0,
    raf: 0,
    warmupMs: 0,
    roundsDone: 0,
  };
  function renderSessionClock(){
    ui.sessionClock.textContent = fmtMs(session.elapsedMs);
  }
  function sessionTick(){
    if (session.status === 'idle' || session.status === 'recap') return;
    if (session.status !== 'paused'){
      session.elapsedMs = Math.max(0, performance.now() - session.startMono);
      renderSessionClock();
    }
    session.raf = requestAnimationFrame(sessionTick);
  }
  function startSessionClock(){
    session.startMono = performance.now() - session.elapsedMs;
    cancelAnimationFrame(session.raf);
    session.raf = requestAnimationFrame(sessionTick);
  }
  function pauseSessionClock(){
    session.elapsedMs = Math.max(0, performance.now() - session.startMono);
  }
  function stopSessionClock(){
    pauseSessionClock();
    session.status = 'recap';
    cancelAnimationFrame(session.raf);
    session.raf = 0;
    renderSessionClock();
  }
  function resetSessionClock(){
    session.status = 'idle';
    cancelAnimationFrame(session.raf);
    session.raf = 0;
    session.elapsedMs = 0;
    session.warmupMs = 0;
    session.roundsDone = 0;
    renderSessionClock();
  }

  // --- Interval engine
  let phases = [];
  let totalPlannedMs = 0;

  const engine = {
    status: 'idle', // idle | running | paused | finished
    index: 0,
    phaseStartMono: 0,
    phaseDurationMs: 0,
    phaseRemainingMs: 0,
    completedMs: 0,
    lastCueSecond: null,
    raf: 0,
  };

  function buildPhases(c){
    phases = [];
    phases.push({ name:'DÉPART', durMs: c.departSec * 1000, round:null });
    for (let r=1; r<=c.series; r++){
      phases.push({ name:'TRAVAIL', durMs: c.travailSec * 1000, round:r });
      if (c.pauseSec > 0 && r < c.series) phases.push({ name:'PAUSE', durMs: c.pauseSec * 1000, round:r });
    }
    totalPlannedMs = phases.reduce((a,p)=>a+p.durMs, 0);
  }

  function setStage(name, roundText){
    ui.timer.dataset.state = name;
    ui.state.textContent = name;
    ui.roundInfo.textContent = roundText || '—';
  }

  function totalElapsedIntervalsMsNow(){
    if (engine.status === 'idle') return 0;
    if (engine.status === 'finished') return totalPlannedMs;
    if (engine.status === 'paused'){
      return Math.min(totalPlannedMs, engine.completedMs + (engine.phaseDurationMs - engine.phaseRemainingMs));
    }
    const now = performance.now();
    const elapsedInPhase = Math.max(0, now - engine.phaseStartMono);
    return Math.min(totalPlannedMs, engine.completedMs + Math.min(engine.phaseDurationMs, elapsedInPhase));
  }
  function updateTotals(){
    ui.totalPlanned.textContent = fmtMs(totalPlannedMs);
    const elapsed = totalElapsedIntervalsMsNow();
    ui.totalRemaining.textContent = fmtMs(Math.max(0, totalPlannedMs - elapsed));
  }
  function renderPhase(remainMs, progress01){
    ui.time.textContent = fmtMs(remainMs);
    ui.bar.style.width = `${Math.max(0, Math.min(100, progress01*100))}%`;
    updateTotals();
  }

  function phaseCue(name){
    const ok = ensureAudio();
    if (!ok) return;
    if (name === 'TRAVAIL'){
      beep(880, 0.08, 0.18);
    } else if (name === 'PAUSE'){
      beepMulti([{freq:660,dur:0.06,delay:0},{freq:660,dur:0.06,delay:0.12}]);
    } else if (name === 'DÉPART'){
      beep(420, 0.06, 0.14);
    }
  }
  function maybeCount321(remainMs){
    if (!ui.count321.checked) return;
    const sec = Math.ceil(remainMs / 1000);
    if (sec !== 3 && sec !== 2 && sec !== 1) return;
    if (engine.lastCueSecond === sec) return;
    engine.lastCueSecond = sec;
    const ok = ensureAudio();
    if (ok) beep(1200, 0.05, 0.14);
  }

  function startPhase(i, carryMs=0){
    const c = getConfig();
    engine.index = i;
    const p = phases[i];
    engine.phaseDurationMs = p.durMs;
    engine.completedMs = phases.slice(0, i).reduce((a,x)=>a+x.durMs, 0);
    engine.phaseStartMono = performance.now() - Math.max(0, carryMs);
    engine.lastCueSecond = null;

    const roundText = (p.name === 'TRAVAIL' || p.name === 'PAUSE') ? `Série ${p.round}/${c.series}` : '—';
    setStage(p.name, roundText);
    phaseCue(p.name);

    const remain = Math.max(0, engine.phaseDurationMs - carryMs);
    renderPhase(remain, engine.phaseDurationMs>0 ? (1 - remain/engine.phaseDurationMs) : 0);
  }

  function engineTick(){
    if (engine.status !== 'running') return;

    const now = performance.now();
    const elapsed = now - engine.phaseStartMono;
    let remain = engine.phaseDurationMs - elapsed;

    maybeCount321(remain);

    while (remain <= 0){
      const justEnded = phases[engine.index];
      if (justEnded && justEnded.name === 'TRAVAIL') session.roundsDone = Math.max(session.roundsDone, justEnded.round || 0);

      const carry = -remain;
      const next = engine.index + 1;
      if (next >= phases.length){
        engine.status = 'finished';
        cancelAnimationFrame(engine.raf);
        engine.raf = 0;
        setStage('TERMINÉ', '—');
        ui.time.textContent = '00:00';
        ui.bar.style.width = '100%';
        updateTotals();
        releaseWakeLock();
        session.status = 'finished';
        showFinishControls();
        return;
      }
      startPhase(next, carry);
      remain = engine.phaseDurationMs - (performance.now() - engine.phaseStartMono);
    }

    renderPhase(remain, engine.phaseDurationMs>0 ? (elapsed/engine.phaseDurationMs) : 0);
    engine.raf = requestAnimationFrame(engineTick);
  }

  // --- Controls visibility
  function showWarmupControls(){
    ui.beginWorkoutBtn.hidden = false;
ui.skipBtn.hidden = true;
    ui.stopBtn.hidden = false;
    ui.endBtn.hidden = true;
    ui.newSessionBtn.hidden = true;
    ui.endNowBtn.hidden = false;
    ui.toggleBtn.hidden = true;
    ui.toggleBtn.style.display = 'none';

  }
  function showRunningControls(){
    ui.beginWorkoutBtn.hidden = true;
ui.skipBtn.hidden = false;
    ui.stopBtn.hidden = false;
    ui.endBtn.hidden = true;
    ui.newSessionBtn.hidden = true;
    ui.endNowBtn.hidden = false;
    ui.toggleBtn.hidden = false;
    ui.toggleBtn.style.display = '';

  }
  function showFinishControls(){
    ui.beginWorkoutBtn.hidden = true;
ui.skipBtn.hidden = true;
    ui.stopBtn.hidden = true;
    ui.endBtn.hidden = false;
    ui.newSessionBtn.hidden = true;
    ui.endNowBtn.hidden = true;
    ui.toggleBtn.hidden = true;
    ui.toggleBtn.style.display = 'none';

  }
  function showRecapOnly(){
    ui.beginWorkoutBtn.hidden = true;
// après Terminer
    ui.skipBtn.hidden = true;
    ui.stopBtn.hidden = true;
    ui.endBtn.hidden = true;
    ui.newSessionBtn.hidden = false;
    ui.endNowBtn.hidden = true;
    ui.toggleBtn.hidden = true;
    ui.toggleBtn.style.display = 'none';

  }

  // --- Actions
  async function start(){
    ensureAudio();
    const c = getConfig();
    const errs = validateConfig(c);
    if (errs.length){
      setErrors(errs);
      return;
    }
    setErrors([]);
    clearRecap();

    buildPhases(c);

    ui.setup.hidden = true;
    ui.timer.hidden = false;

    engine.status = 'idle';
    engine.index = 0;
    session.roundsDone = 0;
    session.warmupMs = 0;
    session.elapsedMs = 0;

    ui.totalPlanned.textContent = fmtMs(totalPlannedMs);
    ui.totalRemaining.textContent = fmtMs(totalPlannedMs);
    ui.time.textContent = '00:00';
    ui.bar.style.width = '0%';

    session.status = c.warmupOn ? 'warmup' : 'running';
    startSessionClock();
    await acquireWakeLock();

    if (c.warmupOn){
      setStage('ÉCHAUFFEMENT', '—');
      showWarmupControls();
      return;
    }
    beginWorkout();
  }

  function beginWorkout(){
    if (session.status === 'warmup'){
      session.warmupMs = session.elapsedMs;
    }
    session.status = 'running';

    engine.status = 'running';
    startPhase(0, 0);
    cancelAnimationFrame(engine.raf);
    engine.raf = requestAnimationFrame(engineTick);
    showRunningControls();
  }

  async function togglePauseResume(){
    // If recap displayed, do nothing
    if (session.status === 'recap') return;

    // intervals finished -> control only session clock
    if (engine.status === 'finished'){
      if (session.status === 'paused'){
        session.status = 'finished';
        startSessionClock();
      } else {
        session.status = 'paused';
        pauseSessionClock();
      }
      return;
    }

    if (engine.status === 'running'){
      engine.status = 'paused';
      cancelAnimationFrame(engine.raf);
      engine.raf = 0;

      const now = performance.now();
      const elapsed = Math.max(0, now - engine.phaseStartMono);
      engine.phaseRemainingMs = Math.max(0, engine.phaseDurationMs - elapsed);

      session.status = 'paused';
      pauseSessionClock();
      releaseWakeLock();
      updateTotals();
      return;
    }

    if (engine.status === 'paused'){
      engine.status = 'running';
      await acquireWakeLock();
      ensureAudio();
      engine.lastCueSecond = null;

      engine.phaseStartMono = performance.now() - (engine.phaseDurationMs - engine.phaseRemainingMs);

      session.status = 'running';
      startSessionClock();

      engine.raf = requestAnimationFrame(engineTick);
      return;
    }
  }

  function skip(){
    if (!(engine.status === 'running' || engine.status === 'paused')) return;

    const next = engine.index + 1;
    if (next >= phases.length){
      engine.status = 'finished';
      cancelAnimationFrame(engine.raf);
      engine.raf = 0;
      setStage('TERMINÉ', '—');
      ui.time.textContent = '00:00';
      ui.bar.style.width = '100%';
      updateTotals();
      releaseWakeLock();
      session.status = 'finished';
      showFinishControls();
      return;
    }

    const wasPaused = (engine.status === 'paused');
    engine.status = 'running';
    startPhase(next, 0);
    updateTotals();

    if (wasPaused){
      engine.status = 'paused';
      const now = performance.now();
      const elapsed = Math.max(0, now - engine.phaseStartMono);
      engine.phaseRemainingMs = Math.max(0, engine.phaseDurationMs - elapsed);
      return;
    }
    if (!engine.raf) engine.raf = requestAnimationFrame(engineTick);
  }

  function stop(){
    engine.status = 'idle';
    cancelAnimationFrame(engine.raf);
    engine.raf = 0;
    releaseWakeLock();

    resetSessionClock();

    ui.endNowBtn.hidden = true;
    ui.setup.hidden = false;
    ui.timer.hidden = true;

    setStage('PRÊT', '—');
    ui.time.textContent = '00:00';
    ui.bar.style.width = '0%';
    ui.timer.dataset.state = 'PRÊT';
    clearRecap();
  }

  function endWorkout(){
    // v1.1.1: Terminer = arrêt complet (chrono principal + intervalles)
    try{ cancelAnimationFrame(engine.raf); }catch(e){}
    engine.raf = 0;
    engine.status = 'finished';
    releaseWakeLock();

    // stoppe le chrono principal
    stopSessionClock();

    // Force l'affichage final côté intervalle
    try{
      setStage('TERMINÉ', '—');
      ui.time.textContent = '00:00';
      ui.bar.style.width = '100%';
      updateTotals();
    }catch(e){}

    // Affiche le récap + bouton Nouvelle séance uniquement
    const warmup = session.status === 'warmup' ? session.elapsedMs : (session.warmupMs || 0);
    const roundsDone = session.roundsDone || 0;
    const total = session.elapsedMs;

    ui.recap.hidden = false;
    ui.recap.innerHTML = `
      <h3>Récapitulatif</h3>
      <div class="line"><div class="k">Temps échauffement</div><div class="v">${fmtMs(warmup)}</div></div>
      <div class="line"><div class="k">Séries effectuées</div><div class="v">${roundsDone}</div></div>
      <div class="line"><div class="k">Temps total</div><div class="v">${fmtMs(total)}</div></div>
    `;

    showRecapOnly();
  }

  function newSession(){
    stop();
  }

  // Wire UI
  ui.startBtn.addEventListener('click', start);
  ui.beginWorkoutBtn.addEventListener('click', beginWorkout);
  ui.toggleBtn.addEventListener('click', togglePauseResume);
  ui.skipBtn.addEventListener('click', skip);
  ui.stopBtn.addEventListener('click', stop);
  ui.endBtn.addEventListener('click', endWorkout);
  ui.endNowBtn.addEventListener('click', endWorkout);
  ui.newSessionBtn.addEventListener('click', newSession);

  ui.wakeHint.hidden = !!('wakeLock' in navigator);

  [ui.work, ui.rest, ui.rounds, ui.countdown].forEach(inp => inp.addEventListener('input', computePlannedTotal));
  ui.warmupOn.addEventListener('change', computePlannedTotal);
  computePlannedTotal();
  renderSessionClock();
})();
/* --- Installation PWA (GitHub Pages) ---
   Sur certains Android/Chrome, le menu n'affiche pas "Installer".
   Cette logique affiche un bouton uniquement si Chrome déclenche beforeinstallprompt.
*/
(function(){
  const installBtn = document.getElementById('installBtn');
  const installHint = document.getElementById('installHint');
  const installDiag = document.getElementById('installDiag');
  if (!installBtn || !installHint) return;

  let deferredPrompt = null;

  function setDiag(msg){
    if (!installDiag) return;
    installDiag.style.display = 'block';
    installDiag.textContent = msg;
  }

  // Affiche le mode d'affichage (utile pour savoir si c'est une vraie PWA)
  const isStandalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  if (isStandalone){
    installHint.textContent = "App installée (mode plein écran).";
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
    installHint.textContent = "App prête à être installée.";
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
    installHint.textContent = (choice && choice.outcome === 'accepted')
      ? "Installation lancée. Si besoin, cherche l'app dans tes applications."
      : "Installation annulée.";
  });

  // Diagnostics légers (ne prouve pas l'installabilité, mais aide à voir ce qui manque)
  (async () => {
    try {
      // service worker
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg || (!reg.active && !reg.installing && !reg.waiting)) {
          setDiag("Diagnostic: Service worker non actif (attends quelques secondes puis recharge).");
          return;
        }
      } else {
        setDiag("Diagnostic: Service worker non supporté sur ce navigateur.");
        return;
      }

      // manifest + icons reachability
      const base = location.origin + location.pathname.replace(/[^/]*$/, '');
      const manUrl = base + "manifest.webmanifest";
      const mr = await fetch(manUrl, {cache:'no-store'});
      if (!mr.ok) { setDiag("Diagnostic: manifest introuvable (" + mr.status + ")."); return; }
      const m = await mr.json();
      const icon = (m.icons && m.icons[0] && m.icons[0].src) ? m.icons[0].src : null;
      if (icon) {
        const iconUrl = icon.startsWith('http') ? icon : (icon.startsWith('/') ? (location.origin + icon) : (base + icon));
        const ir = await fetch(iconUrl, {cache:'no-store'});
        if (!ir.ok) { setDiag("Diagnostic: icône introuvable (" + ir.status + ")."); return; }
      }

      // If we are here, basics look OK. If button still not shown, it's usually Chrome heuristics (visites).
      setDiag("Diagnostic: OK (manifest + icônes + service worker). Si le bouton Installer n'apparaît pas, visite la page 2 fois et attends 10s, puis réessaie.");
    } catch (err) {
      setDiag("Diagnostic: erreur (" + (err && err.message ? err.message : err) + ")");
    }
  })();
})();
