/* Repair the satellite before the sixty-second launch window closes. */
import * as cg from '../render/core/cg.js';
import { ControllerBeam } from '../render/core/controllerInput.js';

export const init = async model => {
   const ROUND_SECONDS = 20;
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
      const text = { name, value, y, scale, node: model.add(name) };
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

   makeText('orrTitle', 'ORBITAL REPAIR RUSH', 2.62, 2, textColor);
   makeText('orrInstructions',
      'Point and hold trigger to grab. Dock each part, then hold to weld.',
      2.5, 1.5, textColor);
   const statusText = makeText('orrStatus', 'STATUS: GRAB A PART TO START', 2.36, 1.3, textColor);
   const scoreText = makeText('orrScore', 'SCORE: 0', 2.24, 1.4, textColor);
   const timerText = makeText('orrTimer', 'TIME: '+ROUND_SECONDS, 2.24, 1.4, textColor);
   const repairText = makeText('orrRepairs', 'REPAIRS: 0/3', 2.24, 1.4, textColor);
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

   // Each part owns its model, target marker, hit area, and game state.
   const parts = [
      { name: 'left panel',  start: [-.42, .83, -1.1], target: [-.32, 1.43, -1.1], color: [.18, .5, 1.3], kind: 'panel' },
      { name: 'right panel', start: [.42, .83, -1.1],  target: [.32, 1.43, -1.1],  color: [.18, .5, 1.3], kind: 'panel' },
      { name: 'dish',        start: [0, .82, -1.1],    target: [0, 1.77, -1.1],   color: [1.1, .75, .25], kind: 'dish' },
   ].map(data => {
      const node = model.add();
      const animated = node.add();
      if (data.kind === 'panel') {
         animated.add('cube').scale(.18, .11, .016).color(data.color);
         for (const x of [-.09, 0, .09])
            animated.add('tubeY').move(x, 0, .019).scale(.004, .105, .004).color(.65, .85, 1);
      } else {
         animated.add('tubeY').scale(.012, .11, .012).color(.85, .85, .95);
         animated.add('torusZ').move(0, .12, 0).scale(.105, .105, .018).color(data.color);
         animated.add('sphere').move(0, .12, 0).scale(.035).color(1.4, 1.2, .7);
      }

      // Eighteen dots make a lightweight glowing socket around the docking position.
      const socket = model.add();
      for (let i = 0; i < 18; i++) {
         const angle = 2 * Math.PI * i / 18;
         socket.add('sphere').move(Math.cos(angle), Math.sin(angle), 0).scale(.05);
      }
      return { ...data, node, animated, socket,
         socketRadius: data.kind === 'dish' ? .095 : .12,
         hit: data.kind === 'dish' ? node.add().move(0, .06, 0).scale(.15, .20, 1)
                                   : node.add().scale(.21, .15, 1),
         position: data.start.slice(), status: 'loose', progress: 0, grabbed: false };
   });

   let phase = 'ready';
   let startedAt = null;
   let remaining = ROUND_SECONDS;
   let score = 0;
   let allWeldedAt = null;

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
         if (held[hand]) held[hand].grabbed = false;
         held[hand] = null;
         grabStart[hand] = null;
      }
   };

   const resetGame = () => {
      clearHands();
      triggerDown.left = triggerDown.right = false;
      phase = 'ready';
      startedAt = null;
      remaining = ROUND_SECONDS;
      score = 0;
      allWeldedAt = null;
      for (const part of parts) {
         part.position = part.start.slice();
         part.status = 'loose';
         part.progress = 0;
         part.grabbed = false;
      }
   };

   const finishGame = won => {
      phase = won ? 'won' : 'lost';
      if (won) {
         remaining = Math.max(0, ROUND_SECONDS - (model.time - startedAt));
         score += Math.ceil(remaining) * 10;
         allWeldedAt = model.time;
      } else {
         remaining = 0;
      }
      clearHands();
      for (const hand of ['left', 'right']) buzz(hand, won ? 1 : .35, won ? 220 : 120);
   };

   // After game over both triggers must overlap; otherwise a press selects a part.
   inputEvents.onPress = hand => {
      triggerDown[hand] = true;
      if (phase === 'won' || phase === 'lost') {
         if (triggerDown.left && triggerDown.right) resetGame();
         return;
      }
      beams[hand].update();
      let closest = Infinity;
      for (const part of parts) {
         if (part.grabbed || part.status === 'welded') continue;
         const hit = beams[hand].hitRect(part.hit.getGlobalMatrix());
         if (hit && hit[2] < closest) {
            closest = hit[2];
            held[hand] = part;
         }
      }
      if (!held[hand]) return;

      if (phase === 'ready') {
         phase = 'playing';
         startedAt = model.time;
      }

      held[hand].grabbed = true;
      if (held[hand].status === 'loose') {
         const pose = controllerPose(hand);
         grabStart[hand] = {
            origin: pose.origin,
            depth: Math.max(.15, cg.dot(cg.subtract(held[hand].position, pose.origin), pose.direction)),
         };
      }
      buzz(hand, .3);
   };

   // Loose parts follow the ray; docked parts fill their welding progress meter.
   inputEvents.onDrag = (hand, elapsed) => {
      const part = held[hand];
      if (!part || phase !== 'playing') return;
      if (part.status === 'docked') {
         part.progress = Math.min(1, elapsed / WELD_SECONDS);
         if (model.time % .16 < .02) buzz(hand, .2 + .45 * part.progress, 25);
         return;
      }

      beams[hand].update();
      const pose = controllerPose(hand);
      const distance = Math.max(.15, grabStart[hand].depth -
         (depthGain - 1) * (pose.origin[2] - grabStart[hand].origin[2]));
      part.position = cg.add(pose.origin, cg.scale(pose.direction, distance));
   };

   // Releasing near a socket docks a part; releasing after a full hold welds it.
   inputEvents.onRelease = hand => {
      triggerDown[hand] = false;
      const part = held[hand];
      if (!part || phase !== 'playing') return;

      if (part.status === 'loose' &&
          Math.hypot(...part.position.map((value, i) => value - part.target[i])) < .13) {
         part.position = part.target.slice();
         part.status = 'docked';
         score += DOCK_POINTS;
         buzz(hand, .75, 100);
      } else if (part.status === 'docked') {
         if (part.progress >= 1) {
            part.status = 'welded';
            score += WELD_POINTS;
            buzz(hand, 1, 180);
            if (parts.every(item => item.status === 'welded')) finishGame(true);
         }
         part.progress = 0;
      }

      part.grabbed = false;
      held[hand] = null;
      grabStart[hand] = null;
   };

   model.animate(() => {
      for (const hand of ['left', 'right']) beams[hand].update();

      if (phase === 'playing') {
         remaining = Math.max(0, ROUND_SECONDS - (model.time - startedAt));
         if (remaining === 0) finishGame(false);
      }

      const weldedCount = parts.filter(part => part.status === 'welded').length;
      updateText(statusText, phase === 'ready' ? 'STATUS: GRAB A PART TO START' :
                             phase === 'playing' ? 'STATUS: REPAIR IN PROGRESS' :
                             phase === 'won' ? 'STATUS: MISSION COMPLETE' : 'STATUS: TIME EXPIRED');
      updateText(scoreText, `SCORE: ${score}`);
      updateText(timerText, `TIME: ${Math.ceil(remaining)}`)
         .color(remaining < 5 ? [1.4, .15, .1] : textColor);
      updateText(repairText, `REPAIRS: ${weldedCount}/3`);
      layoutHudRow();
      updateText(outcomeText, phase === 'won' ? 'YOU WIN! SATELLITE RESTORED. PRESS BOTH TRIGGERS TO RESTART.' :
                              phase === 'lost' ? 'YOU LOSE! REPAIR WINDOW MISSED. PRESS BOTH TRIGGERS TO RESTART.' : ' ')
         .color(phase === 'won' ? [.2, 1.4, .5] : [1.4, .25, .15]);

      const unfolded = allWeldedAt === null ? 0 : Math.min(1, (model.time - allWeldedAt) / 2);
      for (const part of parts) {
         part.node.identity().move(part.position);
         part.animated.identity();
         if (part.status === 'welded' && part.kind === 'panel')
            part.animated.turnY((part.target[0] < 0 ? -1 : 1) * .22 * (1 - unfolded));

         part.socket.color(part.status === 'welded' ? [.15, 1.3, .4] :
                           part.status === 'docked' ? [1.4, .8, .1] : [.15, .55, 1.2]);
         const radius = part.socketRadius * (part.status === 'docked' ? 1 + part.progress * .45 : 1);
         part.socket.identity().move(part.target[0], part.target[1], part.target[2] + .025)
                    .scale(radius).opacity(part.status === 'welded' ? 0 : 1);
      }

      const radius = .5 + .04 * Math.sin(model.time * 6);
      success.identity().move(center).scale(radius).opacity(phase === 'won' ? unfolded * .7 : 0);
   });
};

// Prevent this scene's controller callbacks from leaking into the next scene.
export const deinit = () => {
   inputEvents.onPress = inputEvents.onDrag = inputEvents.onRelease = () => {};
};
