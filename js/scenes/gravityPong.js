import * as cg from '../render/core/cg.js';
import { G2 } from '../util/g2.js';
import { controllerMatrix, joyStickState } from '../render/core/controllerInput.js';
import { lcb, rcb } from '../handle_scenes.js';
import { C, createGame, serve, reset, activateShield, step } from '../util/gravity-pong.js';

const origin = [0, 1.35, -1.8];
const colors = [[.05,.9,1], [1,.12,.65]];
const names = ['CYAN', 'MAGENTA'];
const clamp = (v, limit) => Math.max(-limit, Math.min(limit, v));

export const init = async model => {
   // The framework also reinitializes scenes on focus, without calling deinit.
   window.gravityPongCleanup?.();
   const previousMode = window.interactMode;
   window.interactMode = 1;
   // Keep neon colors and screen textures independent of the classroom lighting.
   model.customShader('color = pow(5. * ambient * rgba.rgb, vec3(2.));');
   window.gravityPongInputs ||= {};
   window.gravityPong ||= { ...createGame(), seats: [], handled: {} };
   const local = { active:true, session:Math.random().toString(36), seq:0,
                   paddle:[0,0], power:.5, commands:[] };
   const seen = {}, keys = new Set(), panels = [], sliders = [], shieldButtons = [];
   let grab = null;
   let commandID = 0, lastSend = -1, lastSound = gravityPong.eventID;
   let previousWinner = gravityPong.winner;
   let flashTime = -1, flashPos = [0,0,0], previousSeats = '';
   const side = () => gravityPong.seats.indexOf(window.clientID);
   const resultText = () => gravityPong.winner < 0 ? '' : side() < 0 ?
      names[gravityPong.winner]+' WINS' : side() === gravityPong.winner ? 'YOU WIN!' : 'YOU LOSE';
   const publish = () => {
      if (window.clientID === undefined) return;
      gravityPongInputs[clientID] = local;
      local.seq++;
      server.broadcastGlobalElement('gravityPongInputs', clientID);
   };
   const command = type => {
      unlockAudio();
      if (side() < 0) return;
      local.commands.push({ n:++commandID, type }); publish();
   };

   // Reuse bouncing.js's samples, with one spatial source per hit.
   const audio = new AudioContext(), sounds = [];
   let audioError = '';
   Promise.all(Array.from({length:6}, async (_, i) => {
      const response = await fetch(`/media/sound/bounce/${i}.wav`);
      if (!response.ok) throw Error('Bounce sample unavailable');
      sounds[i] = await audio.decodeAudioData(await response.arrayBuffer());
   })).catch(() => { audioError = 'Sound samples unavailable'; });
   const unlockAudio = () => { if (audio.state === 'suspended') audio.resume().catch(() => {}); };
   const playHit = event => {
      if (audio.state !== 'running' || !sounds[event.id % 6]) return;
      const source = audio.createBufferSource(), panner = audio.createPanner(), gain = audio.createGain();
      source.buffer = sounds[event.id % 6];
      source.playbackRate.value = event.kind === 'goal' ? .65 : event.kind === 'paddle' ? 1.25 : 1;
      panner.panningModel = 'HRTF';
      panner.refDistance = 1; panner.rolloffFactor = .6;
      panner.setPosition(...cg.mTransform(arena.getMatrixFromRoot(), event.pos));
      gain.gain.value = event.kind === 'wall' ? .22 : .5;
      source.connect(gain).connect(panner).connect(audio.destination);
      source.onended = () => { source.disconnect(); gain.disconnect(); panner.disconnect(); };
      source.start();
   };
   const playResult = won => {
      if (audio.state !== 'running') return;
      const notes = won ? [523.25,659.25,783.99,1046.5] : [392,329.63,261.63,196];
      notes.forEach((frequency,i) => {
         const tone = audio.createOscillator(), gain = audio.createGain();
         const start = audio.currentTime + .12 + i*.14;
         tone.type = won ? 'triangle' : 'sine';
         tone.frequency.value = frequency;
         gain.gain.setValueAtTime(0,start);
         gain.gain.linearRampToValueAtTime(.12,start+.015);
         gain.gain.exponentialRampToValueAtTime(.001,start+.22);
         tone.connect(gain).connect(audio.destination);
         tone.onended = () => { tone.disconnect(); gain.disconnect(); };
         tone.start(start); tone.stop(start+.24);
      });
   };
   const updateListener = () => {
      const head = window.vr ? clientState.head(clientID) :
         window.views?.[0] ? cg.mMultiply(cg.mInverse(worldCoords), cg.mInverse(views[0].viewMatrix)) : null;
      if (!head?.length) return;
      audio.listener.setPosition(...head.slice(12,15));
      audio.listener.setOrientation(-head[8],-head[9],-head[10],head[4],head[5],head[6]);
   };

   // A small desktop companion uses the same inputs as the in-world widgets.
   const desktop = document.createElement('section');
   desktop.id = 'gravity-pong-controls';
   desktop.innerHTML = `<style>
      #gravity-pong-controls {position:fixed;bottom:18px;left:18px;z-index:5;max-width:380px;
         padding:16px 20px;border:1px solid #24546c;border-radius:14px;color:#dcedff;
         background:#061321ed;font:14px/1.5 system-ui;box-shadow:0 0 35px #00d9ff15}
      #gravity-pong-controls strong {color:#6ef4ff;letter-spacing:2px}
      #gravity-pong-controls p {margin:7px 0}
      #gravity-pong-controls button {background:#143247;color:#e9f8ff;border:1px solid #36708b;
         border-radius:7px;padding:8px 12px;margin:5px 5px 0 0;cursor:pointer}
   </style><strong>GRAVITY / PONG</strong><p role="status">Connecting…</p>
      <p>Move: <b>WASD / arrows</b> · Shield: <b>Space</b><br>
      VR: aim at your paddle and hold the trigger to steer.<br>First to 5. Serve after each point.</p>
      <button data-action="serve">Serve</button><button data-action="shield">Shield</button>
      <button data-action="reset">New match</button><button data-action="sound">Enable sound</button>`;
   document.body.appendChild(desktop);
   desktop.querySelectorAll('button').forEach(button => button.onclick = () => {
      if (button.dataset.action === 'sound') unlockAudio();
      else command(button.dataset.action);
      button.blur();
   });
   const keydown = event => {
      if (event.target.matches('input,textarea')) return;
      const key = event.key.toLowerCase();
      if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright',' '].includes(key)) {
         event.preventDefault(); event.stopPropagation(); keys.add(key); unlockAudio();
         if (key === ' ' && !event.repeat) command('shield');
      }
   };
   const keyup = event => {
      if (keys.delete(event.key.toLowerCase())) { event.preventDefault(); event.stopPropagation(); }
   };
   const blur = () => { keys.clear(); grab = null; };
   window.addEventListener('keydown', keydown, true);
   window.addEventListener('keyup', keyup, true);
   window.addEventListener('blur', blur);
   document.addEventListener('pointerdown', unlockAudio);
   const oldPress = inputEvents.onPress;

   const court = model.add().label('gravityPongCourt');
   const arena = court.add().move(origin);
   const box = (parent, p, size, color) => parent.add('cube').move(p).scale(size).color(color).dull();
   const line = (a,b,r,color) => arena.add('tubeZ').placeLimb(a,b,r).color(color).dull();
   box(model, [0,2,-4], [40,20,.02], [.006,.012,.028]);
   box(arena, [0,-.63,0], [1.5,.055,.85], [.015,.035,.065]);
   for (let i = -6; i <= 6; i++)
      line([i*.23,-.57,-.78], [i*.23,-.57,.78], .0025, [.02,.18,.25]);
   for (let i = -3; i <= 3; i++)
      line([-1.45,-.57,i*.23], [1.45,-.57,i*.23], .0025, [.02,.18,.25]);
   for (const y of [-C.halfHeight,C.halfHeight])
      for (const z of [-C.halfDepth,C.halfDepth])
         line([-C.halfWidth,y,z], [C.halfWidth,y,z], .005, [.08,.3,.45]);
   for (const x of [-C.halfWidth,C.halfWidth]) {
      const color = colors[x < 0 ? 0 : 1];
      for (const z of [-C.halfDepth,C.halfDepth]) line([x,-.55,z], [x,.55,z], .012, color);
      for (const y of [-C.halfHeight,C.halfHeight]) line([x,y,-.55], [x,y,.55], .012, color);
   }
   for (let i = 0; i < 9; i++)
      line([0,-.55,i*.13-.52], [0,.55,i*.13-.52], .002, [.035,.13,.2]);
   // Fixed stars and concentric underfloor rings give depth without extra assets.
   for (let i = 0; i < 45; i++)
      model.add('sphere').move(3.7*Math.sin(i*37), .4+2.8*(.5+.5*Math.cos(i*19)), -3.9)
         .scale(.003 + .004*(i%3)).color([.2,.4,.6]).dull();
   for (const r of [.35,.65,.95])
      arena.add('ringY').move(0,-.565,0).scale(r,1,r*.7).color([.02,.22,.32]).dull();

   const paddles = [], shields = [];
   for (let i = 0; i < 2; i++) {
      const paddle = arena.add().label('gravityPongPaddle'+i);
      paddle.add('sphere').scale(.018,C.paddleRadius,C.paddleRadius).color(colors[i]).dull();
      paddle.add('ringX').scale(C.paddleRadius).color([1,1,1]).dull();
      paddles.push(paddle);
      const cage = arena.add().label('gravityPongShield'+i).move(i ? 1.18 : -1.18,0,0)
         .color(colors[i]).dull().opacity(0);
      const bar = (a,b) => cage.add('tubeZ').placeLimb(a,b,.004);
      for (const x of [-.06,.06])
         for (let k = -2; k <= 2; k++) {
            const t = k*.275;
            bar([x,-.55,t],[x,.55,t]);
            bar([x,t,-.55],[x,t,.55]);
         }
      for (const y of [-.55,.55])
         for (const z of [-.55,.55]) bar([-.06,y,z],[.06,y,z]);
      shields.push(cage);
   }
   const paddlePoint = (hand, owner) => {
      if (!window.vr || owner < 0) return null;
      const beam = hand === 'left' ? lcb : rcb;
      const pose = window.handtracking ? clay.handsWidget.getMatrix(hand,1,0) : controllerMatrix[hand];
      if (!beam || pose?.length !== 16 || !pose.every(Number.isFinite)) return null;
      // Framework beams normally update after scene callbacks; refresh this hand now.
      beam.update(window.handtracking ? pose : undefined);
      const plane = cg.mMultiply(arena.getGlobalMatrix(), cg.mMultiply(
         cg.mTranslate(owner ? C.paddleX : -C.paddleX,0,0), cg.mRotateY(owner ? Math.PI/2 : -Math.PI/2)));
      const hit = beam.hitRect(plane,true);
      return hit?.every(Number.isFinite) ? [hit[1], (owner ? -1 : 1)*hit[0]] : null;
   };
   const press = hand => {
      unlockAudio();
      if (grab || gravityPong.winner >= 0) return;
      const owner = side(), point = paddlePoint(hand,owner);
      if (!point) return;
      const center = gravityPong.paddles[owner];
      if (Math.hypot(point[0]-center[0], point[1]-center[1]) > C.paddleRadius) return;
      local.paddle = center.slice();
      grab = {hand, side:owner, handtracking:window.handtracking,
              offset:point.map((v,i) => v-center[i])};
   };
   inputEvents.onPress = press;
   const trail = Array.from({length:12}, () => arena.add('sphere').color([1,.45,.1]).dull());
   const history = [];
   const ball = arena.add('sphere').scale(C.radius).color([1,.9,.5]).dull();
   const orbit = arena.add('ringZ').color([1,.7,.2]).dull();
   const pulse = arena.add('ringZ').color([1,.75,.3]).dull();

   const panel = (parent, slot, position, scale, title, width=512, height=512) => {
      const g = new G2(false, width, height);
      model.txtrSrc(slot, g.getCanvas());
      const face = parent.add('square').move(position).scale(scale).txtr(slot).dull();
      g.render = () => {
         g.setColor('#071a2b').fillRect(-1,-1,2,2);
         g.setColor('#71def5').textHeight(height < width ? .18 : .09)
            .text(title,0,height < width ? .6 : .72,'center');
      };
      const vrUVZ = g.computeUVZ;
      g.computeUVZ = matrix => {
         if (window.vr) return vrUVZ(matrix);
         const view = window.views?.[0];
         if (!view) return null;
         // G2's example desktop ray assumes a fixed screen; use the actual camera.
         const rect = clay.gl.canvas.getBoundingClientRect();
         const point = cg.mTransform(cg.mInverse(view.projectionMatrix),
            [2*(mouseX-rect.left)/rect.width-1, 1-2*(mouseY-rect.top)/rect.height, -1]);
         return cg.mHitRect(cg.mMultiply(cg.mInverse(view.viewMatrix),
            cg.mAimZ(cg.scale(point,-1))),matrix);
      };
      panels.push(g);
      return {g,face};
   };
   for (let i = 0; i < 2; i++) {
      const color = i ? '#ff71be' : '#68eeff', direction = i ? -1 : 1;
      const post = arena.add().move(i ? C.halfWidth : -C.halfWidth,0,i ? .85 : -.85)
         .turnY(i ? Math.PI/2 : -Math.PI/2);
      const {g,face} = panel(post,3+i, [0,.28,0], [.25,.29,1], names[i] + ' / STEER');
      g.addWidget(face,'trackpad',0,0,color,'', value => {
         if (side() === i) local.paddle = [(value[1]-.5)*.7, direction*(value[0]-.5)*.7];
      },2.3);
      shieldButtons.push(g.addWidget(face,'button',0,-.75,color,['SHIELD'],() => {
         if (side() === i) command('shield');
      },2.4));
      const render = g.render;
      g.render = () => {
         render();
         const p = gravityPong.paddles[i];
         g.setColor('#ffffff').fillOval(direction*p[1]/.7*1.15-.035,p[0]/.7*1.15-.035,.07,.07);
      };
      const power = panel(post,5+i, [0,-.24,0], [.25,.13,1], 'RETURN POWER',512,256);
      sliders.push(power.g.addWidget(power.face,'slider',0,-.05,color,'',value => {
         if (side() === i) local.power = value;
      },3));
   }
   const score = panel(model,7, [0,2.5,-1.8], [.86,.27,1], 'GRAVITY / PONG',1024,320);
   score.g.render = () => {
      score.g.setColor('#071321').fillRect(-1,-1,2,2);
      score.g.setColor('#75d7ef').textHeight(.16).text('GRAVITY / PONG',0,.72,'center');
      score.g.textHeight(.52).setColor('#68eeff').text(''+gravityPong.score[0],-.82,.12,'center');
      score.g.setColor('#ff71be').text(''+gravityPong.score[1],.82,.12,'center');
      const label = gravityPong.winner >= 0 ? resultText() :
         gravityPong.solo ? 'SOLO / BOT OPPONENT' : 'TWO PLAYERS / FIRST TO 5';
      score.g.setColor('#c0d8e8').textHeight(.13).text(label,0,-.32,'center');
   };
   score.g.addWidget(score.face,'button',-.35,-.73,'#68eeff',['SERVE'],() => command('serve'),2.1);
   score.g.addWidget(score.face,'button',.35,-.73,'#ff71be',['NEW MATCH'],() => command('reset'),2.1);
   const result = panel(model,8, [0,1.6,-.45], [.57,.18,1], '',1024,320);
   result.face.label('gravityPongResult').opacity(0);
   result.g.render = () => {
      if (gravityPong.winner < 0) return;
      const accent = side() < 0 ? (gravityPong.winner ? '#ff71be' : '#68eeff') :
         side() === gravityPong.winner ? '#7dffbb' : '#ff7ba8';
      result.g.setColor('#071321').fillRect(-1,-1,2,2);
      result.g.setColor(accent).fillRect(-1,.96,2,.04).fillRect(-1,-1,2,.04);
      result.g.textHeight(.32).text(resultText(),0,.22,'center');
      result.g.setColor('#dcedff').textHeight(.12)
         .text(gravityPong.score.join(' : ')+'  /  NEW MATCH to play again',0,-.45,'center');
   };

   let uiTime = 0;
   model.animate(() => {
      const now = performance.now()/1000, dt = Math.min(model.deltaTime || 1/60,.05);
      const s = window.gravityPong;
      const ownSide = side();
      const direction = ownSide === 1 ? -1 : 1;
      const stick = window.vr ? joyStickState.right : {x:0,y:0};
      const horizontal = (keys.has('d') || keys.has('arrowright') ? 1 : 0)
                       - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
      const vertical = (keys.has('w') || keys.has('arrowup') ? 1 : 0)
                     - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
      if (grab && (!inputEvents.isPressed(grab.hand) || !window.vr || grab.side !== ownSide ||
                   grab.handtracking !== window.handtracking)) grab = null;
      if (grab) {
         const point = paddlePoint(grab.hand,grab.side);
         if (point) local.paddle = point.map((v,i) => clamp(v-grab.offset[i],.35));
         else grab = null;
      } else {
         local.paddle[0] = clamp(local.paddle[0] + dt*(vertical-(Math.abs(stick.y)>.15 ? stick.y : 0))*.85,.35);
         local.paddle[1] = clamp(local.paddle[1] + direction*dt*(horizontal+(Math.abs(stick.x)>.15 ? stick.x : 0))*.85,.35);
      }
      const sendFrame = now-lastSend > 1/30;
      if (sendFrame) { publish(); lastSend = now; }

      // Each browser owns its input; only the first active scene participant runs physics.
      const active = (window.clients || []).filter(id => {
         const input = gravityPongInputs[id];
         if (!input?.active) return false;
         if (seen[id]?.seq !== input.seq || seen[id]?.session !== input.session)
            seen[id] = {seq:input.seq, session:input.session, time:now};
         return now-seen[id].time < 2;
      });
      if (active.length && active[0] === clientID) {
         const seats = active.slice(0,2);
         if (JSON.stringify(s.seats) !== JSON.stringify(seats)) {
            s.seats = seats; s.solo = seats.length < 2; reset(s);
         }
         seats.forEach((id,i) => {
            const input = gravityPongInputs[id];
            if (Array.isArray(input.paddle) && input.paddle.length === 2 && input.paddle.every(Number.isFinite))
               s.paddles[i] = input.paddle.map(v => clamp(v,.35));
            if (Number.isFinite(input.power)) s.power[i] = Math.max(0,Math.min(1,input.power));
            const ack = s.handled[id]?.session === input.session ? s.handled[id].n : 0;
            for (const action of input.commands || []) {
               if (!Number.isInteger(action.n) || action.n <= ack) continue;
               if (action.type === 'serve') serve(s);
               if (action.type === 'reset') reset(s);
               if (action.type === 'shield') activateShield(s,i);
               s.handled[id] = {session:input.session, n:action.n};
            }
         });
         step(s,dt);
         if (sendFrame) server.broadcastGlobal('gravityPong');
      }
      const ack = s.handled[clientID];
      if (ack?.session === local.session) local.commands = local.commands.filter(c => c.n > ack.n);
      if (s.winner >= 0) {
         grab = null;
         if (s.winner !== previousWinner && side() >= 0) playResult(side() === s.winner);
      }
      previousWinner = s.winner;
      result.face.opacity(s.winner >= 0 ? 1 : 0);
      if (previousSeats !== JSON.stringify(s.seats)) {
         previousSeats = JSON.stringify(s.seats); history.length = 0;
      }
      // Rotate the presentation so each player faces down the court from their own goal.
      const viewSide = Math.max(0,side());
      court.identity().move(origin).turnY(viewSide ? -Math.PI/2 : Math.PI/2)
         .move(origin.map(v => -v));
      for (let i = 0; i < 2; i++) {
         paddles[i].identity().move(i ? C.paddleX : -C.paddleX,...s.paddles[i]);
         paddles[i].child(0).opacity(i === viewSide ? 0 : 1);
         paddles[i].child(1).color(grab?.side === i ? [1,.85,.15] : colors[i]);
         const remaining = s.shield[i];
         const blink = Math.floor((1.25-remaining)*8) % 2 === 0;
         shields[i].opacity(remaining > 0 && blink ? Math.min(1,remaining/.3) : 0);
         sliders[i].setValue(s.power[i]);
         shieldButtons[i].setLabel([s.cooldown[i] > 0 ? Math.ceil(s.cooldown[i])+'s' : 'SHIELD']);
      }
      if (s.playing) history.unshift(s.p.slice()); else history.length = 0;
      history.length = Math.min(history.length,trail.length);
      trail.forEach((node,i) => node.identity().move(history[i] || s.p)
         .scale(history[i] ? C.radius*(1-i/13)*.7 : 0));
      ball.identity().move(s.p).scale(C.radius*(s.playing ? 1 : 1+.1*Math.sin(now*3)));
      orbit.identity().move(s.p).turnY(now*1.7).turnX(.6).scale(C.radius*1.5);
      for (const event of s.events) if (event.id > lastSound) {
         playHit(event); lastSound = event.id; flashTime = now; flashPos = event.pos;
         if (event.kind === 'goal' || event.kind === 'serve') history.length = 0;
      }
      const age = now-flashTime;
      pulse.identity().move(flashPos).turnY(viewSide ? Math.PI/2 : -Math.PI/2)
         .scale(age < .4 ? .07+age*.8 : 0).opacity(Math.max(0,1-age/.4));
      updateListener();
      panels.forEach(g => g.update());
      if (now-uiTime > .1) {
         uiTime = now;
         const role = ownSide >= 0 ? `You are ${names[ownSide]}` : 'Spectating';
         const shield = ownSide < 0 ? '' : s.cooldown[ownSide] > 0 ?
            `Shield recharges in ${Math.ceil(s.cooldown[ownSide])}s.` : 'Shield ready.';
         desktop.querySelector('[role=status]').textContent = `${role} · ${s.solo ? 'Solo vs bot' : 'Two players'} · `+
            `${s.score.join(' : ')}. ${s.winner >= 0 ? resultText()+' / New match to play again.' :
            s.playing ? shield : 'Press Serve to start the rally.'}`;
         desktop.querySelector('[data-action=sound]').textContent = audioError ||
            (audio.state === 'running' ? 'Sound on' : 'Enable sound');
         desktop.style.display = window.vr ? 'none' : '';
      }
   });

   window.gravityPongCleanup = () => {
      local.active = false; publish();
      desktop.remove();
      window.removeEventListener('keydown',keydown,true); window.removeEventListener('keyup',keyup,true);
      window.removeEventListener('blur',blur); document.removeEventListener('pointerdown',unlockAudio);
      if (inputEvents.onPress === press) inputEvents.onPress = oldPress;
      window.interactMode = previousMode;
      audio.close().catch(() => {});
   };
};

export const deinit = () => { window.gravityPongCleanup?.(); delete window.gravityPongCleanup; };
