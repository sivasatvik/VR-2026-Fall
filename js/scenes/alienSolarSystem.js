import * as cg from '../render/core/cg.js';
import { ControllerBeam, joyStickState } from '../render/core/controllerInput.js';
import { AIQuery } from '../util/aiquery.js';
import { CENTER, CHANNEL, PRESETS, AI_PROMPT, PLANET_TEXTURES, createState, normalizeSystem,
   planetPosition, simulationTime, applyAction, readSnapshot, beamDepth, beamPosition, rayHit, pickSavedSystem } from '../util/alien-solar-state.js';

let cleanup = () => {};

export const init = async (model, ctx, ctxForever = {}) => {
   ctxForever.cleanup?.();
   let active = true, state = createState(Date.now() / 1000), ready = false, lastSeq = 0;
   let clock = { at: Date.now() / 1000, local: performance.now() / 1000 };
   let lastJoin = -Infinity, lastExpire = -Infinity, epoch = -1, selection = -1;
   let lastFrame = model.time, pendingGeneration = null, runningToken = null;
   const members = new Set(), buffered = [], held = { left: null, right: null };
   const down = { left: false, right: false }, lastSent = { left: -Infinity, right: -Infinity };
   const beams = { left: new ControllerBeam(model, 'left'), right: new ControllerBeam(model, 'right') };
   const updateBeam = hand => beams[hand].update(window.handtracking ? clay.handsWidget.getMatrix(hand, 1, 0) : undefined);
   const ai = new AIQuery({ timeout: 65000 });
   const localNow = () => performance.now() / 1000;
   const sharedNow = () => clock.at + localNow() - clock.local;
   const send = (op, extra = {}) => {
      if (active && ready && window.clientID !== undefined)
         server.send(CHANNEL, { op, epoch: state.epoch, ...extra });
   };
   server.init(CHANNEL, state, { actionsOnly: true });
   // Scene switches can happen while texture images are still decoding.
   cleanup = () => {
      if (!active) return;
      active = false;
      server.send(CHANNEL, { op: 'leave' });
      server.sync(CHANNEL, () => {});
      server.stopActions(CHANNEL);
      model.customShader('');
   };
   ctxForever.cleanup = cleanup;

   model.customShader(`
      uniform int uAlienPlanet;
      uniform int uAlienStar;
      uniform int uAlienHalo;
      uniform int uAlienAtmosphere;
      uniform int uAlienRing;
      uniform vec3 uAlienSun;
      ---------------------------------------------------------------------
      if (uAlienPlanet == 1 || uAlienRing == 1) {
         float daylight = max(0., dot(normalize(worldNormal), normalize(uAlienSun - worldPosition)));
         color = rgba.rgb * diffuse * (.10 + 1.05 * daylight);
      }
      if (uAlienStar == 1) color = rgba.rgb * diffuse * 1.65;
      if (uAlienHalo == 1 || uAlienAtmosphere == 1) {
         float rim = pow(1. - abs(dot(normalize(worldNormal), eye)), 2.5);
         color = diffuse * 1.4;
         opacity *= rim;
      }
   `);
   const asset = file => 'media/textures/alien-solar-system/' + file;
   const sources = { star: asset('star.jpg'), moon: 'media/textures/moon_diffuse.jpg',
      ...Object.fromEntries(Object.entries(PLANET_TEXTURES).map(([id, texture]) => [id, asset(texture.file)])) };
   const savedSystemsPromise = fetch('media/data/alien-solar-systems.json').then(response => {
      if (!response.ok) throw new Error('Saved systems could not be loaded.');
      return response.json();
   }).then(entries => {
      if (!Array.isArray(entries)) throw new Error('Saved systems must be a JSON array.');
      // shortcut: The VR panel fits three saved systems; add paging if the catalog grows.
      return entries.slice(0, 3).map(entry => {
         if (!entry || !['id', 'label', 'prompt'].every(key => typeof entry[key] === 'string') ||
             !Array.isArray(entry.keywords) || entry.keywords.some(word => typeof word !== 'string'))
            throw new Error('Invalid saved system metadata.');
         return { ...entry, system: normalizeSystem(entry.system) };
      });
   })
      .catch(error => { console.error(error); return []; });
   // Await decoding so texture uploads cannot race another scene's texture slots after deinit.
   const images = Object.fromEntries(await Promise.all(Object.entries(sources).map(([name, src]) => new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve([name, image]);
      image.onerror = () => { console.error('Surface texture could not be loaded:', src); resolve([name, null]); };
      image.src = src;
   }))));
   const savedSystems = await savedSystemsPromise;
   if (!active) return;
   const slotImages = {};
   const surface = (node, name, slot) => {
      const image = images[name] || images[PLANET_TEXTURES[name]?.type];
      if (image) {
         // Reuse five GPU slots; the renderer has 16, with several reserved for text.
         if (!slotImages[slot]) model.txtrSrc(slot, image, true);
         else if (slotImages[slot] !== image) {
            window._canvas_txtr[slot].src = image;
            window._canvas_txtr[slot].counter = 1;
         }
         slotImages[slot] = image;
         node.txtr(slot);
      }
      return node;
   };

   // Deterministic backdrop: every client builds the same stars without network traffic.
   const stars = model.add();
   for (let i = 0; i < 180; i++) {
      const y = 1 - 2 * (i + .5) / 180, a = i * 2.399963, r = Math.sqrt(1 - y * y);
      stars.add('sphere').move(10 * r * Math.cos(a), 1.4 + 10 * y, 10 * r * Math.sin(a))
         .scale(.012 + .012 * (i % 5) / 4).color(.6 + .08 * (i % 4), .8, 1.2).dull();
   }
   const systemRoot = model.add(), textRoot = model.add();
   const controlsPanel = model.add().move(-1.65, 1.4, -1.6);
   controlsPanel.add('square').move(0, -.06, 0).scale(.76, 1.11, 1).color(.008, .018, .035).dull().opacity(.96);
   const buttonRoot = controlsPanel.add().move(0, 0, .012);
   const panel = model.add().move(1.75, 1.5, -1.5);
   panel.add('square').scale(.64, .86, 1).color(.008, .018, .035).dull().opacity(.94);
   panel.add('cube').move(-.62, 0, .006).scale(.003, .81, .002).color(.2, .8, 1.1).dull();
   const panelText = panel.add().move(-.56, .75, .012);
   const meshPrefix = 'alienSolar';
   const texts = {};
   const setText = (key, value, parent, position, scale = .7, color = [.7, .9, 1.15]) => {
      if (!texts[key]) texts[key] = { value: null, node: parent.add(meshPrefix + key).move(position).scale(scale).color(color).dull() };
      if (texts[key].value !== value) {
         clay.defineTextMesh(meshPrefix + key, value);
         texts[key].value = value;
      }
   };
   const centeredText = (key, value, y, z, scale) => {
      setText(key, value, textRoot, [0, y, z], scale);
      const bounds = clay.meshBounds(meshPrefix + key);
      texts[key].node.identity().move(-(bounds.lo[0] + bounds.hi[0]) * scale / 2, y, z).scale(scale);
   };
   const wrap = (value, width = 38) => {
      const words = value.split(/\s+/), lines = [''];
      for (const raw of words) {
         for (let start = 0; start < raw.length; start += width) {
            const word = raw.slice(start, start + width), last = lines.length - 1;
            if (lines[last] && lines[last].length + word.length + 1 > width) lines.push(word);
            else lines[last] += (lines[last] ? ' ' : '') + word;
         }
      }
      return lines.join('\n');
   };

   const buttons = [];
   const makeButton = (label, x, y, action, width = .21) => {
      const root = buttonRoot.add().move(x, y, 0);
      const face = root.add('square').scale(width, .055, 1).color(.03, .12, .19).dull();
      const key = 'Button' + buttons.length;
      setText(key, label, root, [-label.length * .019 * 1.2 / 2, -.012, .005], 1.2);
      buttons.push({ face, action });
   };
   const requestGeneration = (prompt, savedId) => {
      if (!ready || state.generation || pendingGeneration) return;
      prompt = String(prompt).trim().slice(0, 600);
      if (!prompt) return;
      pendingGeneration = { token: window.clientID + '-' + Date.now() + '-' + Math.random().toString(36).slice(2), prompt, savedId };
      send('generate', pendingGeneration);
   };
   makeButton('GENERATE', -.48, -.50, () => requestGeneration(promptInput.value));
   makeButton('PAUSE', 0, -.50, () => send('pause'));
   makeButton('RESET', .48, -.50, () => send('reset'));
   ['MYSTERY', 'OCEAN LIFE', 'ANCIENT RUINS'].forEach((label, i) =>
      makeButton(label, (i - 1) * .48, -.66, () => { promptInput.value = PRESETS[i]; requestGeneration(PRESETS[i]); }));
   setText('PromptTitle', 'CREATE ALIEN WORLDS', controlsPanel, [-.68, .90, .015], 1.5);
   setText('PromptHint', 'Point at keys and press the trigger to type.', controlsPanel, [-.68, .78, .015], 1.15);
   setText('PromptHint2', 'SAVED buttons load worlds without an AI call.', controlsPanel, [-.68, .70, .015], 1.15);
   controlsPanel.add('square').move(0, .46, .008).scale(.70, .17, 1).color(.02, .06, .09).dull();
   ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM.,?'].forEach((row, r) => {
      [...row].forEach((key, i) => makeButton(key, (i - (row.length - 1) / 2) * .14, .20 - r * .15,
         () => { promptInput.value = (promptInput.value + key.toLowerCase()).slice(0, 600); }, .06));
   });
   makeButton('SPACE', -.48, -.30, () => { promptInput.value = (promptInput.value + ' ').slice(0, 600); });
   makeButton('BACKSPACE', 0, -.30, () => { promptInput.value = promptInput.value.slice(0, -1); });
   makeButton('CLEAR', .48, -.30, () => { promptInput.value = ''; });
   savedSystems.forEach((entry, i) => makeButton('SAVED ' + entry.label.toUpperCase(), (i - 1) * .48, -.82,
      () => { promptInput.value = entry.prompt; requestGeneration(entry.prompt, entry.id); }));
   centeredText('Instructions', 'Hold trigger to grab. Thumbstick forward/back changes distance.', 2.19, -1.65, .95);
   centeredText('Instructions2', 'Release to orbit. Point at the star to inspect the system.', 2.08, -1.65, .95);

   // Both interfaces edit the same local draft; only generation shares it with other players.
   const ui = document.createElement('form');
   ui.id = 'alien-solar-controls';
   ui.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:1000;box-sizing:border-box;width:min(540px,calc(100vw - 32px));padding:14px;border:1px solid #345064;border-radius:12px;background:#07131fee;color:#e0f4ff;font:14px system-ui;box-shadow:0 8px 36px #0008';
   const title = document.createElement('strong'); title.textContent = 'ALIEN SOLAR SYSTEM';
   const hint = document.createElement('div'); hint.textContent = 'Describe three worlds, or try a preset. Everyone shares the result.';
   hint.style.cssText = 'font-size:12px;color:#9bb9cd;margin:5px 0 9px';
   const promptInput = document.createElement('textarea');
   promptInput.setAttribute('aria-label', 'Describe your alien solar system');
   promptInput.maxLength = 600; promptInput.rows = 2; promptInput.value = PRESETS[0];
   promptInput.style.cssText = 'box-sizing:border-box;width:100%;resize:vertical;background:#102536;color:#edf8ff;border:1px solid #345064;border-radius:6px;padding:8px;font:13px system-ui';
   const row = document.createElement('div'); row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px';
   const desktopButtons = [];
   const desktopButton = (label, action, generation = false) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
      b.style.cssText = 'background:#173d53;color:#e0f4ff;border:1px solid #34637a;border-radius:6px;padding:7px 10px;cursor:pointer';
      b.addEventListener('click', action); row.append(b); desktopButtons.push({ b, generation }); return b;
   };
   desktopButton('Generate', () => requestGeneration(promptInput.value), true);
   const pauseButton = desktopButton('Pause orbits', () => send('pause'));
   desktopButton('Reset positions', () => send('reset'));
   ['Mystery', 'Ocean life', 'Ancient ruins'].forEach((label, i) => desktopButton(label, () => {
      promptInput.value = PRESETS[i]; requestGeneration(PRESETS[i]);
   }, true));
   savedSystems.forEach(entry => desktopButton('Load saved ' + entry.label, () => {
      promptInput.value = entry.prompt; requestGeneration(entry.prompt, entry.id);
   }, true));
   const status = document.createElement('div'); status.setAttribute('role', 'status');
   status.style.cssText = 'color:#9bb9cd;font-size:12px;margin-top:9px';
   const inspection = document.createElement('div'); inspection.style.cssText = 'display:flex;gap:6px;margin-top:7px;flex-wrap:wrap';
   ui.append(title, hint, promptInput, row, inspection, status);
   ui.addEventListener('submit', e => { e.preventDefault(); requestGeneration(promptInput.value); });
   document.body.append(ui);

   let star, halo, planets = [], renderedSystem = null;
   const clear = node => { while (node.nChildren()) node.remove(0); };
   const rebuild = () => {
      clear(systemRoot); renderedSystem = state.system;
      star = surface(systemRoot.add('sphere'), 'star', 1).flag('uAlienStar').dull();
      halo = systemRoot.add('sphere').flag('uAlienHalo').dull().opacity(.22);
      planets = state.system.planets.map((p, id) => {
         const root = systemRoot.add();
         const body = surface(root.add('sphere'), p.texture, id + 3).color(p.color).flag('uAlienPlanet').dull();
         const atmosphere = p.type !== 'rocky' && p.type !== 'volcanic'
            ? root.add('sphere').scale(p.radius * 1.045).color(p.color).flag('uAlienAtmosphere').opacity(.24).dull() : null;
         if (p.rings) for (let n = 0; n < 6; n++)
            root.add('torusY').turnZ(.35).scale(p.radius * (1.45 + n * .12), p.radius * .035, p.radius * (1.45 + n * .12))
               .color(.65 + n * .055, .58 + n * .05, .45 + n * .045).flag('uAlienRing').opacity(.65).dull();
         const moonPivot = p.moon ? root.add() : null;
         if (moonPivot) surface(moonPivot.add('sphere'), 'moon', 2).move(p.radius * 2, 0, 0).scale(p.radius * .23).flag('uAlienPlanet').dull();
         const marker = root.add('ringZ').scale(p.radius * 1.25).color(.2, 1, 1.4).opacity(0).dull();
         const orbit = systemRoot.add();
         const path = [];
         for (let j = 0; j <= 128; j++) path.push([Math.cos(j * Math.PI / 64), 0, Math.sin(j * Math.PI / 64)]);
         clay.definePathsMesh(meshPrefix + 'Orbit' + id, .0018, [path]);
         orbit.add(meshPrefix + 'Orbit' + id).color(.12, .26, .36).dull().opacity(.5);
         return { root, body, atmosphere, moonPivot, marker, orbit };
      });
      inspection.replaceChildren();
      ['Star', ...state.system.planets.map(p => p.name)].forEach((label, i) => {
         const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
         b.style.cssText = 'background:none;color:#9bdcf5;border:1px solid #345064;border-radius:5px;padding:4px 8px;cursor:pointer';
         b.addEventListener('click', () => { selection = i - 1; }); inspection.append(b);
      });
      centeredText('Title', state.system.name.toUpperCase(), 2.4, -1.65, 1.8);
   };

   const controllerPose = hand => {
      updateBeam(hand);
      const matrix = cg.mMultiply(cg.mInverse(window.worldCoords), beams[hand].beamMatrix());
      return { origin: matrix.slice(12, 15), direction: cg.normalize(matrix.slice(8, 11).map(x => -x)),
         right: cg.normalize(matrix.slice(0, 3)), up: cg.normalize(matrix.slice(4, 7)) };
   };
   const draggedPosition = hand => {
      const h = held[hand], pose = controllerPose(hand);
      const point = beamPosition(pose.origin, pose.direction, h.depth);
      return point.map((x, i) => Math.round((x + pose.right[i] * h.offset[0] + pose.up[i] * h.offset[1]) * 10000) / 10000);
   };
   const buzz = hand => {
      if (!window.handtracking && typeof window.vibrate === 'function') window.vibrate(hand, .35, 45);
   };
   inputEvents.onPress = hand => {
      down[hand] = true;
      const pose = controllerPose(hand);
      let nearest = Infinity, target = null;
      for (const b of buttons) {
         const hit = beams[hand].hitRect(b.face.getGlobalMatrix());
         if (hit && hit[2] > 0 && hit[2] < nearest) { nearest = hit[2]; target = { button: b }; }
      }
      const starHit = rayHit(pose.origin, pose.direction, CENTER, state.system.star.radius);
      if (starHit !== null && starHit < nearest) { nearest = starHit; target = { id: -1 }; }
      state.planets.forEach((p, id) => {
         const hit = rayHit(pose.origin, pose.direction, planetPosition(state, id, sharedNow()), state.system.planets[id].radius * 1.12);
         if (hit !== null && hit < nearest) { nearest = hit; target = { id }; }
      });
      if (!target) return;
      if (target.button) { target.button.action(); buzz(hand); return; }
      if (!ready) return;
      selection = target.id;
      if (selection < 0 || state.planets[selection].owner !== null || held[hand]) return;
      const position = planetPosition(state, selection, sharedNow()), delta = cg.subtract(position, pose.origin);
      held[hand] = { id: selection, depth: Math.max(.25, cg.dot(delta, pose.direction)),
         offset: [cg.dot(delta, pose.right), cg.dot(delta, pose.up)], confirmed: false };
      send('grab', { id: selection, hand }); buzz(hand);
   };
   inputEvents.onDrag = hand => {
      const h = held[hand];
      if (!h?.confirmed || localNow() - lastSent[hand] < .05) return;
      send('move', { id: h.id, hand, position: draggedPosition(hand) });
      lastSent[hand] = localNow();
   };
   inputEvents.onRelease = hand => {
      down[hand] = false;
      if (held[hand]) send('release', { id: held[hand].id, hand, position: draggedPosition(hand) });
      held[hand] = null;
   };
   inputEvents.onClick = () => {};

   const apply = (msg, sender) => {
      if (msg.seq <= lastSeq) return;
      lastSeq = msg.seq;
      if (msg.op === 'join') members.add(sender);
      if (msg.op === 'leave') members.delete(sender);
      applyAction(state, msg, sender);
      if (msg.op === 'grab' && sender === window.clientID && held[msg.hand]?.id === msg.id) {
         const p = state.planets[msg.id];
         if (p.owner === sender && p.hand === msg.hand) {
            held[msg.hand].confirmed = true;
            if (!down[msg.hand]) send('release', { id: msg.id, hand: msg.hand, position: p.position });
         } else held[msg.hand] = null;
      }
      if (msg.op === 'generate' && pendingGeneration?.token === msg.token &&
          state.generation?.token !== msg.token) pendingGeneration = null;
   };
   const receive = (messages, sender) => {
      for (const msg of Object.values(messages)) {
         if (!Number.isInteger(msg.seq) || !Number.isFinite(msg.at)) continue;
         // Never let delayed packets move the local clock backwards.
         if (msg.at >= clock.at) clock = { at: msg.at, local: localNow() };
         if (msg.op === 'join') {
            (msg.peers || []).forEach(id => members.add(id)); members.add(sender);
            if (!ready && sender === window.clientID && msg.peers?.length === 0) {
               state = createState(msg.at); ready = true;
            }
            if (ready && msg.peers?.[0] === window.clientID) {
               apply(msg, sender);
               server.send(CHANNEL, { op: 'snapshot', to: sender, through: lastSeq, state: JSON.parse(JSON.stringify(state)) });
            }
         }
         if (msg.op === 'snapshot' && msg.to === window.clientID && !ready && Number.isInteger(msg.through) && msg.through < msg.seq) {
            try {
               state = readSnapshot(msg.state); lastSeq = msg.through; ready = true;
               buffered.splice(0).sort((a, b) => a.msg.seq - b.msg.seq).forEach(item => apply(item.msg, item.sender));
            } catch (e) { console.error(e); }
         }
         if (ready) apply(msg, sender);
         else if (msg.op !== 'snapshot') buffered.push({ msg, sender });
      }
   };

   const generate = async request => {
      runningToken = request.token;
      try {
         if (request.savedId !== undefined) {
            const entry = savedSystems.find(entry => entry.id === request.savedId);
            if (!entry) throw new Error('That saved system is unavailable.');
            send('generated', { token: request.token, system: entry.system,
               notice: 'Saved system: ' + entry.system.name + '. Loaded without an AI request.' });
            return;
         }
         const data = await ai.askAIJson(AI_PROMPT + request.prompt, { timeout: 65000 });
         const system = normalizeSystem(data);
         if (active && state.generation?.token === request.token) send('generated', { token: request.token, system });
      } catch (e) {
         if (active && state.generation?.token === request.token) {
            const entry = request.savedId === undefined ? pickSavedSystem(savedSystems, request.prompt) : null;
            if (entry) send('generated', { token: request.token, system: entry.system,
               notice: 'AI unavailable. Saved fallback: ' + entry.system.name + '. Closest saved theme; not a new AI response.' });
            else send('generationError', { token: request.token, error: e.message });
         }
      } finally {
         if (pendingGeneration?.token === request.token) pendingGeneration = null;
         if (runningToken === request.token) runningToken = null;
      }
   };

   model.animate(() => {
      if (!active) return;
      const now = localNow(), at = sharedNow(), dt = Math.max(0, Math.min(.05, model.time - lastFrame));
      lastFrame = model.time;
      if (!ready && window.clientID !== undefined && now - lastJoin > 1) {
         server.send(CHANNEL, { op: 'join' }); lastJoin = now;
      }
      if (ready && now - lastExpire > 1 && (state.planets.some(p => p.owner !== null && at - p.lastHeard > 3) ||
          (state.generation && at - state.generation.at > 90))) { send('expire'); lastExpire = now; }
      server.sync(CHANNEL, receive);
      window[CHANNEL] = state;
      if (epoch !== state.epoch) {
         epoch = state.epoch; held.left = held.right = null; selection = -1;
         pendingGeneration = null;
      }
      if (renderedSystem !== state.system) rebuild();
      if (pendingGeneration && !runningToken && state.generation?.owner === window.clientID &&
          state.generation.token === pendingGeneration.token) generate({ ...pendingGeneration });
      const time = simulationTime(state, sharedNow());
      for (const hand of ['left', 'right']) {
         updateBeam(hand);
         const h = held[hand];
         if (!h) continue;
         const p = state.planets[h.id];
         if (h.confirmed && (p.owner !== window.clientID || p.hand !== hand)) { held[hand] = null; continue; }
         h.depth = beamDepth(h.depth, window.handtracking ? 0 : joyStickState[hand]?.y, dt);
      }
      star.identity().move(CENTER).turnY(time * .04).scale(state.system.star.radius).color(state.system.star.color);
      halo.identity().move(CENTER).scale(state.system.star.radius * (1.15 + .035 * Math.sin(time * 1.5))).color(state.system.star.color);
      model.setUniform('3fv', 'uAlienSun', cg.mTransform(window.worldCoords, CENTER));
      planets.forEach((render, id) => {
         const p = state.system.planets[id], shared = state.planets[id];
         const localHand = ['left', 'right'].find(hand => held[hand]?.id === id && held[hand].confirmed);
         const position = localHand ? draggedPosition(localHand) : planetPosition(state, id, sharedNow());
         render.root.identity().move(position);
         render.body.identity().turnY(time * p.spin).scale(p.radius);
         render.moonPivot?.identity().turnY(time * .65);
         render.marker.opacity(shared.owner !== null ? .65 : selection === id ? .35 : 0)
            .color(shared.owner !== null && shared.owner !== window.clientID ? [1.1, .4, .65] : [.2, 1, 1.4]);
         render.marker.faceViewer().scale(p.radius * 1.25);
         const o = shared.orbit;
         const normal = cg.cross(o.v, o.u);
         render.orbit.setMatrix([ ...o.u, 0, ...normal, 0, ...o.v, 0, ...CENTER, 1 ]).scale(o.radius)
            .opacity(shared.owner !== null ? 0 : 1);
      });
      panel.faceViewer();
      controlsPanel.faceViewer();
      const promptLines = wrap(promptInput.value || 'Type your idea here...', 45).split('\n');
      setText('Prompt', promptLines.slice(-4).join('\n') + ' _', controlsPanel, [-.66, .56, .015], 1.3);
      const p = selection < 0 ? null : state.system.planets[selection];
      const info = p ? [p.name.toUpperCase(), p.type.toUpperCase() + ' WORLD',
         PLANET_TEXTURES[p.texture].name.toUpperCase(), '',
         'SURFACE', wrap(p.surface), '', 'ATMOSPHERE', wrap(p.atmosphere), '',
         'LIFE', wrap(p.life), '', 'DISCOVERY', wrap(p.discovery)]
         : [state.system.star.name.toUpperCase(), 'SYSTEM STAR', '', wrap(state.system.star.description), '',
            state.system.name.toUpperCase(), wrap(state.system.description), '',
            'Grab a planet to inspect it.', '', 'Fictional worlds. Sizes and', 'distances are scaled for VR.'];
      setText('Info', info.join('\n'), panelText, [0, 0, 0], 1.5, [.8, .93, 1.08]);
      const message = !ready ? 'Connecting to shared space...' : state.generation
         ? 'Loading worlds... your current system remains available.' : state.error || state.notice || 'Ready. ' + members.size + ' explorer' + (members.size === 1 ? '' : 's') + ' connected.';
      status.textContent = message;
      setText('Status', wrap(message, 65), controlsPanel, [-.68, -.96, .015], 1.0);
      pauseButton.textContent = state.clock.paused ? 'Resume orbits' : 'Pause orbits';
      setText('Button1', state.clock.paused ? 'RESUME' : 'PAUSE', buttons[1].face, [0, 0, 0]);
      for (const { b, generation } of desktopButtons) {
         b.disabled = !ready || (generation && !!(state.generation || pendingGeneration));
         b.style.opacity = b.disabled ? '.45' : '1';
      }
      for (const button of buttons) {
         const hover = ['left', 'right'].some(hand => { const h = beams[hand].hitRect(button.face.getGlobalMatrix()); return h && h[2] > 0; });
         button.face.color(hover ? [.08, .29, .38] : [.03, .12, .19]);
      }
   });

   cleanup = () => {
      if (!active) return;
      server.send(CHANNEL, { op: 'leave' });
      server.sync(CHANNEL, receive);
      server.stopActions(CHANNEL);
      active = false; ui.remove();
      inputEvents.onPress = inputEvents.onDrag = inputEvents.onRelease = inputEvents.onClick = () => {};
      model.customShader('');
   };
   ctxForever.cleanup = cleanup;
};

export const deinit = () => cleanup();
