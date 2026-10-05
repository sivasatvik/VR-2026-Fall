/* Co-op satellite repair: six parts, one shared mission, and looping music. */
import * as cg from '../render/core/cg.js';
import { ControllerBeam } from '../render/core/controllerInput.js';
import { createPositionalEmitter, resumePositionalAudio } from '../util/positional-audio.js';

let cleanup = () => {};

export const init = async (model, ctx, ctxForever = {}) => {
   // The scene loader reuses ctxForever on reload, even when it reimports this module.
   if (ctxForever.cleanup) ctxForever.cleanup();
   const ROUND_SECONDS = 30;
   const WELD_SECONDS = 1.2;
   const DOCK_POINTS = 100;
   const WELD_POINTS = 200;
   const center = [0, 1.43, -1.1];
   const textColor = [.3, .8, 1.4];
   const depthGain = 2.5;
   const beams = {
      left: new ControllerBeam(model, 'left'),
      right: new ControllerBeam(model, 'right'),
   };
   const held = { left: null, right: null };
   const grabStart = { left: null, right: null };
   const triggerDown = { left: false, right: false };
   const lastSent = { left: 0, right: 0 };
   const lastPosition = { left: null, right: null };
   const CHANNEL = 'orbitalRepairCoop';
   const now = () => Date.now() / 1000;
   let audioEnabled = false;
   const effectFiles = {
      grab: 'SFXs/demoBalls/SFX_Ball_Create_Mono_01.wav',
      move: 'SFXs/demoBalls/SFX_Ball_Drag_Mono_LP_01.wav',
      release: 'SFXs/demoPuzzle/SFX_Puzzle_Move_Mono_01.wav',
      dock: 'bounce/0.wav',
      weld: 'orbital-welding.wav',
      done: 'pianoNotes/c6.mp3',
   };
   const playAudio = audio => audio.play().catch(() => {});
   const music = new Audio('media/sound/outfoxing.mp3');
   music.loop = true;
   music.volume = .22;
   const updateMusic = () => {
      const phase = window[CHANNEL]?.phase;
      const selected = phase === 'won' ? victory : phase === 'lost' ? failure : music;
      for (const audio of [music, victory, failure]) {
         if (audioEnabled && audio === selected) {
            if (audio.paused) playAudio(audio);
         } else {
            audio.pause();
            if (audio !== music) audio.currentTime = 0;
         }
      }
   };
   const startMusic = () => {
      audioEnabled = true;
      resumePositionalAudio().catch(() => {});
      updateMusic();
   };
   const pauseMusic = () => {
      audioEnabled = false;
      music.pause();
      victory.pause();
      failure.pause();
      for (const part of parts) for (const audio of Object.values(part.sounds)) audio.pause();
   };
   window.addEventListener('pointerdown', startMusic);
   window.addEventListener('keydown', startMusic);
   window.addEventListener('blur', pauseMusic);

   // A shell of small stars makes the play area read as outer space from any angle.
   for (let i = 0; i < 120; i++) {
      const vertical = 2 * Math.random() - 1;
      const angle = 2 * Math.PI * Math.random();
      const radius = 8 + 3 * Math.random();
      const horizontal = Math.sqrt(1 - vertical * vertical);
      model.add('sphere').move(radius * horizontal * Math.cos(angle),
                               1.5 + radius * vertical,
                               radius * horizontal * Math.sin(angle))
                         .scale(.018 + .018 * Math.random()).color(.65, .85, 1.4).dull();
   }

   // Build all text from the same vector line font used by the linefont scenes.
   const centerText = text => {
      const bounds = clay.meshBounds(text.name);
      const meshCenter = (bounds.lo[0] + bounds.hi[0]) / 2;
      return text.node.identity()
                      .move(center[0] - text.scale * meshCenter, text.y, center[2])
                      .scale(text.scale);
   };
   const makeText = (name, value, y, scale = 1, color = [1, 1, 1]) => {
      clay.defineTextMesh(name, value);
      // Lift the entire HUD above the antenna AND the top of the docked dish.
      const text = { name, value, y: y + .25, scale, node: model.add(name) };
      centerText(text).color(color);
      return text;
   };
   const updateText = (text, value) => {
      if (text.value !== value) {
         clay.defineTextMesh(text.name, value);
         text.value = value;
         centerText(text);
      }
      return text.node;
   };

   makeText('orrTitle', 'CO-OP ORBITAL REPAIR', 2.62, 2, textColor);
   makeText('orrInstructions',
      'Share the repairs! Release at matching sockets, then hold 1.2s to weld.',
      2.5, 1.1, textColor);
   const statusText = makeText('orrStatus', 'STATUS: GRAB A PART TO START', 2.36, 1.3, textColor);
   const scoreText = makeText('orrScore', 'SCORE: 0', 2.24, 1.4, textColor);
   const timerText = makeText('orrTimer', 'TIME: '+ROUND_SECONDS, 2.24, 1.4, textColor);
   const repairText = makeText('orrRepairs', 'REPAIRS: 0/6', 2.24, 1.4, textColor);
   const crewText = makeText('orrCrew', 'CREW: CONNECTING', 2.02, 1.1, textColor);
   const outcomeText = makeText('orrOutcome', ' ', 2.1, 1.5);
   const hudTexts = [scoreText, timerText, repairText];
   const layoutHudRow = () => {
      const items = hudTexts.map(text => {
         const bounds = clay.meshBounds(text.name);
         return { text, bounds, width: text.scale * (bounds.hi[0] - bounds.lo[0]) };
      });
      const gap = .08;
      let x = center[0] - (items.reduce((sum, item) => sum + item.width, 0) +
                           gap * (items.length - 1)) / 2;
      for (const item of items) {
         item.text.node.identity()
                       .move(x - item.text.scale * item.bounds.lo[0], item.text.y, center[2])
                       .scale(item.text.scale);
         x += item.width + gap;
      }
   };
   layoutHudRow();

   // A planet, satellite body, front panel, and antenna form the central set piece.
   model.add('sphere').move(0, 1.12, -1.85).scale(.39).color(.12, .32, .8);
   const satellite = model.add().move(center);
   satellite.add('cube').scale(.095, .15, .085).color(.67, .72, .8);
   satellite.add('cube').move(0, 0, .095).scale(.065, .06, .015).color(.16, .65, 1.3);
   satellite.add('tubeY').move(0, .19, 0).scale(.012, .09, .012).color(.8, .8, .9);
   const success = model.add('ringZ').color(.2, 1.4, .5);

   // Meshes stay local. Only plain mission/part data goes over the network.
   const parts = [
      { name: 'left panel',  start: [-.42, .83, -1.1], target: [-.32, 1.43, -1.1], color: [.18, .5, 1.3], kind: 'panel' },
      { name: 'right panel', start: [.42, .83, -1.1],  target: [.32, 1.43, -1.1],  color: [.18, .5, 1.3], kind: 'panel' },
      { name: 'dish',        start: [0, .82, -1.1],    target: [0, 1.77, -1.1],   color: [1.1, .75, .25], kind: 'dish' },
      { name: 'battery',     start: [-.75, 1.15, -.85], target: [-.14, 1.15, -1.1], color: [.25, 1.2, .4], kind: 'battery' },
      { name: 'thruster',    start: [.75, 1.15, -.85],  target: [.14, 1.15, -1.1],  color: [1.3, .35, .15], kind: 'thruster' },
      { name: 'navigation',  start: [.65, 1.85, -.85],  target: [0, 1.46, -.94],    color: [1.1, .3, 1.2], kind: 'navigation' },
   ].map(data => {
      const node = model.add();
      const animated = node.add();
      if (data.kind === 'panel') {
         animated.add('cube').scale(.18, .11, .016).color(data.color);
         for (const x of [-.09, 0, .09])
            animated.add('tubeY').move(x, 0, .019).scale(.004, .105, .004).color(.65, .85, 1);
      } else if (data.kind === 'dish') {
         animated.add('tubeY').scale(.012, .11, .012).color(.85, .85, .95);
         animated.add('torusZ').move(0, .12, 0).scale(.105, .105, .018).color(data.color);
         animated.add('sphere').move(0, .12, 0).scale(.035).color(1.4, 1.2, .7);
      } else if (data.kind === 'battery') {
         animated.add('cube').scale(.08, .1, .055).color(data.color);
         for (const x of [-.035, .035])
            animated.add('cube').move(x, .115, 0).scale(.018, .018, .025).color(.85, .85, .95);
      } else if (data.kind === 'thruster') {
         animated.add('tubeY').scale(.07, .1, .07).color(data.color);
         animated.add('torusZ').move(0, -.1, .04).scale(.06).color(.9, .9, 1);
      } else {
         animated.add('cube').scale(.08, .055, .03).color(data.color);
         animated.add('sphere').move(0, 0, .045).scale(.035).color(.4, 1.2, 1.4);
      }

      // Eighteen dots make a lightweight glowing socket around the docking position.
      const socket = model.add();
      for (let i = 0; i < 18; i++) {
         const angle = 2 * Math.PI * i / 18;
         socket.add('sphere').move(Math.cos(angle), Math.sin(angle), 0).scale(.05);
      }
      const ownerMarker = node.add('ringZ').scale(.23).color(1.2, .4, 1.2).opacity(0);
      const label = model.add();
      clay.defineTextMesh('orrPart' + data.kind + data.name.replaceAll(' ', ''), data.name.toUpperCase());
      label.add('orrPart' + data.kind + data.name.replaceAll(' ', '')).scale(.75).color(data.color);
      const sounds = Object.fromEntries(Object.entries(effectFiles).map(([action, file]) => {
         const audio = new Audio('media/sound/' + file);
         audio.preload = 'auto';
         audio.loop = action === 'move' || action === 'weld';
         audio.volume = audio.loop ? .18 : .45;
         return [action, audio];
      }));
      const emitter = createPositionalEmitter(Object.values(sounds));
      return { ...data, node, animated, socket, ownerMarker, label, sounds, emitter,
         heard: {}, previousPosition: data.start.slice(), movedAt: -Infinity,
         socketRadius: data.kind === 'dish' ? .095 : .12,
         hit: data.kind === 'dish' ? node.add().move(0, .06, 0).scale(.15, .20, 1)
                                   : node.add().scale(data.kind === 'panel' ? .21 : .1, .15, 1) };
   });

   const victory = new Audio('media/sound/orbital-victory.wav');
   victory.loop = true;
   victory.preload = 'auto';
   victory.volume = .4;
   const failure = new Audio('media/sound/orbital-failure.wav');
   failure.loop = true;
   failure.preload = 'auto';
   failure.volume = .4;

   const initialState = epoch => ({
      protocol: 2, epoch, phase: 'ready', remaining: ROUND_SECONDS, score: 0,
      startedAt: null, finishedAt: null,
      parts: parts.map(part => ({
         position: part.start.slice(), status: 'loose', progress: 0,
         owner: null, hand: null, heldAt: null, lastHeard: null,
         cues: { grab: 0, release: 0, dock: 0, done: 0 },
      })),
   });
   server.init(CHANNEL, initialState(0), { actionsOnly: true });
   const state = () => window[CHANNEL];
   if (state().protocol !== 2) window[CHANNEL] = initialState(0);
   let localEpoch = state().epoch;
   let ready = false;
   let lastApplied = 0;
   let lastJoin = -Infinity;
   let timeoutSent = null;
   const expirySent = new Map();
   let clockSample = { at: now(), local: now() };
   let lastRelayAt = -Infinity;
   const sharedNow = () => clockSample.at + now() - clockSample.local;
   const pendingActions = [];
   let lastPresence = -Infinity;
   const seenPlayers = new Map();
   const playerKey = id => CHANNEL + 'Player' + id;
   const announcePlayer = active => {
      if (window.clientID === undefined) return;
      const key = playerKey(window.clientID);
      window[key] = { active, ready, tick: (window[key]?.tick || 0) + 1 };
      server.broadcastGlobal(key);
      lastPresence = now();
   };
   const gamePlayers = () => (window.clients || []).filter(id => {
      const presence = window[playerKey(id)];
      if (!presence?.active) return false;
      let seen = seenPlayers.get(id);
      if (!seen || seen.tick !== presence.tick) {
         seen = { tick: presence.tick, at: now() };
         seenPlayers.set(id, seen);
      }
      return now() - seen.at < 3;
   });
   announcePlayer(true);

   const buzz = (hand, strength, duration = 55) => {
      if (!window.handtracking && typeof window.vibrate === 'function')
         window.vibrate(hand, strength, duration);
   };

   // Turn a controller matrix into a scene-space ray used to drag parts in depth.
   const controllerPose = hand => {
      const m = beams[hand].beamMatrix();
      const inverse = cg.mInverse(window.worldCoords);
      const origin = cg.mTransform(inverse, m.slice(12, 15));
      const ahead = cg.mTransform(inverse, [m[12] - m[8], m[13] - m[9], m[14] - m[10]]);
      return { origin, direction: cg.normalize(cg.subtract(ahead, origin)) };
   };

   const clearHands = () => {
      for (const hand of ['left', 'right']) {
         held[hand] = null;
         grabStart[hand] = null;
      }
   };

   const send = (op, hand, extra = {}) => {
      if (!ready || window.clientID === undefined) return;
      server.send(CHANNEL, { op, hand, epoch: state().epoch, ...extra });
   };
   const unlock = part => {
      part.owner = part.hand = part.heldAt = part.lastHeard = null;
      part.progress = 0;
   };
   const finishGame = (won, at) => {
      state().phase = won ? 'won' : 'lost';
      state().finishedAt = at;
      if (won) state().score += Math.ceil(state().remaining) * 10;
      else state().remaining = 0;
      state().parts.forEach(unlock);
   };
   const completeWeld = (part, at) => {
      part.status = 'welded';
      state().score += WELD_POINTS;
      part.cues.done++;
      unlock(part);
      part.progress = 1;
      if (state().parts.every(p => p.status === 'welded')) finishGame(true, at);
   };

   // Every replica applies the same relay-ordered actions and timestamps.
   const applyMessage = (msg, client) => {
      if (msg.seq <= lastApplied) return;
      lastApplied = msg.seq;
      if (msg.op === 'join' || msg.op === 'snapshot') return;
      const at = msg.at;
      if (state().phase === 'playing') {
         state().remaining = Math.max(0, ROUND_SECONDS - (at - state().startedAt));
         if (state().remaining === 0) finishGame(false, at);
      }
      // Expiry is evaluated at an ordered event, never independently by each render loop.
      for (const part of state().parts)
         if (part.owner !== null && at - part.lastHeard > 2) unlock(part);
      if (msg.op === 'leave') {
         for (const part of state().parts) if (part.owner === client) unlock(part);
         return;
      }
      if (!msg || msg.epoch !== state().epoch ||
          !['left', 'right'].includes(msg.hand)) return;
      if (msg.op === 'reset') {
         if (['won', 'lost'].includes(state().phase))
            window[CHANNEL] = initialState(state().epoch + 1);
         return;
      }
      if (['timeout', 'expire', 'join', 'snapshot'].includes(msg.op)) return;
      if (!Number.isInteger(msg.id) || !state().parts[msg.id] ||
          ['won', 'lost'].includes(state().phase)) return;
      const part = state().parts[msg.id];
      // Counts survive snapshots, so a quick grab/release is still audible on other clients.
      part.cues ??= { grab: 0, release: 0, dock: 0, done: 0 };
      const owns = part.owner === client && part.hand === msg.hand;
      if (msg.op === 'grab') {
         if (part.owner !== null || part.status === 'welded' ||
             state().parts.some(p => p.owner === client && p.hand === msg.hand)) return;
         if (state().phase === 'ready') {
            state().phase = 'playing';
            state().startedAt = at;
         }
         part.owner = client;
         part.hand = msg.hand;
         part.heldAt = part.lastHeard = at;
         part.cues.grab++;
      } else if (owns && ['move', 'hold', 'release'].includes(msg.op)) {
         part.lastHeard = at;
         if (part.status === 'loose' && ['move', 'release'].includes(msg.op) &&
             Array.isArray(msg.position) && msg.position.length === 3 &&
             msg.position.every(Number.isFinite)) {
            part.position = msg.position.slice();
         }
         if (part.status === 'docked' && at - part.heldAt >= WELD_SECONDS) {
            completeWeld(part, at);
            return;
         }
         if (msg.op !== 'release') return;
         part.cues.release++;
         if (part.status === 'loose' && cg.distance(part.position, parts[msg.id].target) < .13) {
            part.position = parts[msg.id].target.slice();
            part.status = 'docked';
            state().score += DOCK_POINTS;
            part.cues.dock++;
         }
         unlock(part);
      }
   };
   const becomeReady = () => {
      ready = true;
      for (const item of pendingActions.splice(0)) applyMessage(item.msg, item.client);
      announcePlayer(true);
   };
   const receiveActions = (msgs, client) => {
      for (const msg of Object.values(msgs)) {
         if (!Number.isFinite(msg.at) || !Number.isInteger(msg.seq)) continue;
         if (msg.at >= lastRelayAt) {
            clockSample = { at: msg.at, local: now() };
            lastRelayAt = msg.at;
         }
         if (msg.op === 'snapshot' && msg.to === window.clientID && !ready &&
             msg.state?.protocol === 2 && msg.state.parts?.length === parts.length &&
             Number.isInteger(msg.through) && msg.through < msg.seq) {
            window[CHANNEL] = JSON.parse(JSON.stringify(msg.state));
            lastApplied = msg.through;
            becomeReady();
         }
         if (msg.op === 'join') {
            if (!ready && client === window.clientID && msg.peers?.length === 0) becomeReady();
            const available = (msg.peers || []).filter(id =>
               gamePlayers().includes(id) && window[playerKey(id)]?.ready);
            const provider = available[0] ?? msg.peers?.[0];
            if (ready && provider === window.clientID) {
               applyMessage(msg, client);
               server.send(CHANNEL, { op: 'snapshot', to: client, through: msg.seq,
                  state: JSON.parse(JSON.stringify(state())) });
            }
         }
         if (ready) applyMessage(msg, client);
         else if (msg.op !== 'snapshot') pendingActions.push({ msg, client });
      }
   };
   const draggedPosition = hand => {
      beams[hand].update();
      const pose = controllerPose(hand);
      // Depth follows the original beam direction, including when facing away from the satellite.
      // No play-area clamp: parts can move above, below, beside, or behind the station.
      const distance = grabStart[hand].depth + (depthGain - 1) *
         cg.dot(cg.subtract(pose.origin, grabStart[hand].origin), grabStart[hand].direction);
      return cg.roundVec(4, cg.add(pose.origin, cg.scale(pose.direction, distance)));
   };

   inputEvents.onPress = hand => {
      startMusic();
      if (!ready) return;
      triggerDown[hand] = true;
      if (state().phase === 'won' || state().phase === 'lost') {
         if (triggerDown.left && triggerDown.right) send('reset', hand);
         return;
      }
      held[hand] = null;
      beams[hand].update();
      let closest = Infinity;
      for (let id = 0; id < parts.length; id++) {
         const part = parts[id];
         const shared = state().parts[id];
         if (shared.owner !== null || shared.status === 'welded') continue;
         const hit = beams[hand].hitRect(part.hit.getGlobalMatrix());
         if (hit && hit[2] > 0 && hit[2] < closest) {
            closest = hit[2];
            held[hand] = id;
         }
      }
      if (held[hand] === null) return;
      const pose = controllerPose(hand);
      grabStart[hand] = {
         origin: pose.origin,
         direction: pose.direction,
         depth: cg.dot(cg.subtract(state().parts[held[hand]].position, pose.origin), pose.direction),
      };
      send('grab', hand, { id: held[hand] });
      lastPosition[hand] = state().parts[held[hand]].position.slice();
      lastSent[hand] = -Infinity;
      buzz(hand, .3);
   };

   inputEvents.onDrag = hand => {
      const id = held[hand];
      if (id === null || ['won', 'lost'].includes(state().phase) ||
          now() - lastSent[hand] < .05) return;
      const part = state().parts[id];
      if (part.status === 'docked') {
         if (now() - lastSent[hand] < .2) return;
         send('hold', hand, { id });
         if (model.time % .16 < .02) buzz(hand, .2 + .45 * part.progress, 25);
      } else {
         if (part.status === 'welded') return;
         const position = draggedPosition(hand);
         if (cg.distance(position, lastPosition[hand]) < .001) {
            if (now() - lastSent[hand] < .5) return;
            send('hold', hand, { id });
         } else {
            send('move', hand, { id, position });
            lastPosition[hand] = position;
         }
      }
      lastSent[hand] = now();
   };

   inputEvents.onRelease = hand => {
      triggerDown[hand] = false;
      const id = held[hand];
      if (id !== null) {
         const position = state().parts[id].status === 'loose'
            ? draggedPosition(hand) : state().parts[id].position;
         send('release', hand, { id, position });
      }
      held[hand] = null;
      grabStart[hand] = null;
   };

   model.animate(() => {
      for (const hand of ['left', 'right']) beams[hand].update();
      if (now() - lastPresence >= .5) announcePlayer(true);
      const players = gamePlayers();
      if (!ready && window.clientID !== undefined && now() - lastJoin >= 1) {
         server.send(CHANNEL, { op: 'join' });
         lastJoin = now();
      }
      if (ready && state().phase === 'playing' &&
          sharedNow() >= state().startedAt + ROUND_SECONDS && timeoutSent !== state().epoch) {
         send('timeout', 'left');
         timeoutSent = state().epoch;
      }
      if (ready) for (let id = 0; id < parts.length; id++) {
         const part = state().parts[id];
         const lease = `${state().epoch}:${part.owner}:${part.heldAt}`;
         if (part.owner !== null && sharedNow() - part.lastHeard > 2 && expirySent.get(id) !== lease) {
            send('expire', 'left', { id });
            expirySent.set(id, lease);
         }
      }
      server.sync(CHANNEL, receiveActions);
      if (state().phase === 'playing')
         state().remaining = Math.max(0, ROUND_SECONDS - (sharedNow() - state().startedAt));
      for (const part of state().parts)
         if (part.owner !== null && part.status === 'docked')
            part.progress = Math.min(1, Math.max(0, (sharedNow() - part.heldAt) / WELD_SECONDS));
      if (localEpoch !== state().epoch || ['won', 'lost'].includes(state().phase)) {
         clearHands();
         if (localEpoch !== state().epoch) for (const part of parts) {
            part.heard = {};
            part.movedAt = -Infinity;
            part.previousPosition = part.start.slice();
         }
         localEpoch = state().epoch;
      }

      const { phase, score, remaining } = state();
      updateMusic();
      const weldedCount = state().parts.filter(part => part.status === 'welded').length;
      updateText(statusText, !ready ? 'STATUS: SYNCING MISSION' : phase === 'ready' ? 'STATUS: GRAB A PART TO START' :
                             phase === 'playing' ? 'STATUS: TEAM REPAIR IN PROGRESS' :
                             phase === 'won' ? 'STATUS: MISSION COMPLETE' : 'STATUS: TIME EXPIRED');
      updateText(scoreText, `SCORE: ${score}`);
      updateText(timerText, `TIME: ${Math.ceil(remaining)}`)
         .color(remaining < 5 ? [1.4, .15, .1] : textColor);
      updateText(repairText, `REPAIRS: ${weldedCount}/${parts.length}`);
      updateText(crewText, `CREW: ${players.length} | MATCH PART COLORS | MUSIC STARTS ON TRIGGER`);
      layoutHudRow();
      updateText(outcomeText, phase === 'won' ? 'TEAM WINS! SATELLITE RESTORED. BOTH TRIGGERS TO RESTART.' :
                              phase === 'lost' ? 'TIME EXPIRED! BOTH TRIGGERS TO TRY AGAIN.' : ' ')
         .color(phase === 'won' ? [.2, 1.4, .5] : [1.4, .25, .15]);

      const unfolded = state().finishedAt === null ? 0 : Math.min(1, Math.max(0, (sharedNow() - state().finishedAt) / 2));
      for (let id = 0; id < parts.length; id++) {
         const part = parts[id];
         const shared = state().parts[id];
         part.node.identity().move(shared.position);
         // Transform shared positions into this headset's XR space.
         // The XR frame already updates this Resonance listener from the headset pose.
         part.emitter?.setPosition(part.node.getGlobalMatrix().slice(12, 15));
         for (const [action, count] of Object.entries(shared.cues || {})) {
            if (audioEnabled && count > (part.heard[action] || 0)) {
               part.sounds[action].currentTime = 0;
               playAudio(part.sounds[action]);
            }
            part.heard[action] = count;
         }
         if (cg.distance(shared.position, part.previousPosition) > .0001) part.movedAt = now();
         part.previousPosition = shared.position.slice();
         for (const action of ['move', 'weld']) {
            const audio = part.sounds[action];
            const active = audioEnabled && phase === 'playing' && shared.owner !== null &&
               (action === 'move' ? shared.status === 'loose' && now() - part.movedAt < .15
                                  : shared.status === 'docked' && shared.progress < 1);
            if (active && audio.paused) playAudio(audio);
            if (!active && !audio.paused) { audio.pause(); audio.currentTime = 0; }
         }
         part.label.identity().move(shared.position[0] - .07, shared.position[1] - .22, shared.position[2]);
         part.animated.identity();
         if (shared.status === 'welded' && part.kind === 'panel')
            part.animated.turnY((part.target[0] < 0 ? -1 : 1) * .22 * (1 - unfolded));

         part.ownerMarker.opacity(shared.owner === null ? 0 : .7)
                         .color(shared.owner === window.clientID ? [.2, 1.2, 1.2] : [1.2, .4, 1.2]);
         part.socket.color(shared.status === 'welded' ? [.15, 1.3, .4] :
                           shared.status === 'docked' ? [1.4, .8, .1] : part.color);
         const radius = part.socketRadius * (shared.status === 'docked' ? 1 + shared.progress * .45 : 1);
         part.socket.identity().move(part.target[0], part.target[1], part.target[2] + .025)
                    .scale(radius).opacity(shared.status === 'welded' ? 0 : 1);
      }

      const radius = .5 + .04 * Math.sin(model.time * 6);
      success.identity().move(center).scale(radius).opacity(phase === 'won' ? unfolded * .7 : 0);
   });
   cleanup = () => {
      server.send(CHANNEL, { op: 'leave' });
      server.sync(CHANNEL, receiveActions);
      server.stopActions(CHANNEL);
      announcePlayer(false);
      pauseMusic();
      for (const part of parts) part.emitter?.disconnect();
      window.removeEventListener('pointerdown', startMusic);
      window.removeEventListener('keydown', startMusic);
      window.removeEventListener('blur', pauseMusic);
      inputEvents.onPress = inputEvents.onDrag = inputEvents.onRelease = () => {};
   };
   ctxForever.cleanup = cleanup;
};

// Prevent this scene's controller callbacks from leaking into the next scene.
export const deinit = () => {
   cleanup();
};
