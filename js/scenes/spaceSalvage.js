/* Dock the satellite's missing parts, then hold the trigger to weld them. */
import * as cg from '../render/core/cg.js';
import { ControllerBeam } from '../render/core/controllerInput.js';

export const init = async model => {
   // Store the satellite center, depth speed, controller beams, and grab state.
   const center = [0, 1.43, -1.1];
   const depthGain = 2.5;
   const beams = {
      left: new ControllerBeam(model, 'left'),
      right: new ControllerBeam(model, 'right'),
   };
   const held = { left: null, right: null };
   const grabStart = { left: null, right: null };

   // Stars sit on a distant 3D shell, always behind the nearby satellite and planet.
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

   // Add the instruction label and distant planet behind the satellite.
   model.add('label').info('Drag parts to glowing sockets. Hold trigger to weld.')
                     .move(0, 2.5, -1.1).scale(.028);
   model.add('sphere').move(0, 1.12, -1.85).scale(.39).color(.12, .32, .8);

   // Build the satellite body, front panel, and antenna as one hierarchy.
   const satellite = model.add().move(center);
   satellite.add('cube').scale(.095, .15, .085).color(.67, .72, .8);
   satellite.add('cube').move(0, 0, .095).scale(.065, .06, .015).color(.16, .65, 1.3);
   satellite.add('tubeY').move(0, .19, 0).scale(.012, .09, .012).color(.8, .8, .9);
   // Keep the final green success ring hidden until every part is welded.
   const success = model.add('ringZ').color(.2, 1.4, .5);

   // Define each loose part, its starting point, and its docking target.
   const parts = [
      { name: 'left panel',  start: [-.42, .83, -1.1], target: [-.32, 1.43, -1.1], color: [.18, .5, 1.3], kind: 'panel' },
      { name: 'right panel', start: [.42, .83, -1.1],  target: [.32, 1.43, -1.1],  color: [.18, .5, 1.3], kind: 'panel' },
      { name: 'dish',        start: [0, .82, -1.1],    target: [0, 1.77, -1.1],   color: [1.1, .75, .25], kind: 'dish' },
   ].map(data => {
      // Give every part a movable root and a child for its visual animation.
      let node = model.add();
      let animated = node.add();
      // Build either a solar panel or the antenna dish from simple shapes.
      if (data.kind === 'panel') {
         animated.add('cube').scale(.18, .11, .016).color(data.color);
         for (const x of [-.09, 0, .09])
            animated.add('tubeY').move(x, 0, .019).scale(.004, .105, .004).color(.65, .85, 1);
      } else {
         animated.add('tubeY').scale(.012, .11, .012).color(.85, .85, .95);
         animated.add('torusZ').move(0, .12, 0).scale(.105, .105, .018).color(data.color);
         animated.add('sphere').move(0, .12, 0).scale(.035).color(1.4, 1.2, .7);
      }
      // Small spheres leave clear gaps around each target instead of a thick torus.
      let socket = model.add();
      for (let i = 0; i < 18; i++) {
         const angle = 2 * Math.PI * i / 18;
         socket.add('sphere').move(Math.cos(angle), Math.sin(angle), 0).scale(.05);
      }
      // Save the meshes, hit area, and interaction state used during play.
      return { ...data, node, animated, socket,
         socketRadius: data.kind === 'dish' ? .095 : .12,
         hit: data.kind === 'dish' ? node.add().move(0, .06, 0).scale(.15, .20, 1)
                                   : node.add().scale(.21, .15, 1),
         position: data.start.slice(), status: 'loose', progress: 0, grabbed: false,
         weldedAt: null };
   });

   let allWeldedAt = null;
   // Send controller vibration feedback when a controller is available.
   const buzz = (hand, strength, duration = 55) => {
      if (!window.handtracking && typeof window.vibrate === 'function')
         window.vibrate(hand, strength, duration);
   };
   // Convert the controller beam into a scene-space origin and forward direction.
   const controllerPose = hand => {
      const m = beams[hand].beamMatrix();
      const inverse = cg.mInverse(window.worldCoords);
      const origin = cg.mTransform(inverse, m.slice(12, 15));
      const ahead = cg.mTransform(inverse, [m[12] - m[8], m[13] - m[9], m[14] - m[10]]);
      return {
         origin,
         direction: cg.normalize(cg.subtract(ahead, origin)),
      };
   };

   // Select the closest unwelded part touched by the pressed controller beam.
   inputEvents.onPress = hand => {
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
      if (held[hand]) {
         // Remember the original beam depth so the part does not jump when grabbed.
         held[hand].grabbed = true;
         if (held[hand].status === 'loose') {
            const pose = controllerPose(hand);
            grabStart[hand] = {
               origin: pose.origin,
               depth: Math.max(.15, cg.dot(cg.subtract(held[hand].position, pose.origin), pose.direction)),
            };
         }
         buzz(hand, .3);
      }
   };

   // Move a loose part along the beam or charge welding progress for a docked part.
   inputEvents.onDrag = (hand, elapsed) => {
      const part = held[hand];
      if (!part) return;
      if (part.status === 'docked') {
         part.progress = Math.min(1, elapsed / 1.2);
         if (model.time % .16 < .02) buzz(hand, .2 + .45 * part.progress, 25);
         return;
      }
      beams[hand].update();
      const pose = controllerPose(hand);
      // Multiply controller depth movement so parts move faster toward or away from the user.
      const distance = Math.max(.15, grabStart[hand].depth -
         (depthGain - 1) * (pose.origin[2] - grabStart[hand].origin[2]));
      part.position = cg.add(pose.origin, cg.scale(pose.direction, distance));
   };

   // Dock nearby parts, finish fully charged welds, and clear the active grab.
   inputEvents.onRelease = hand => {
      const part = held[hand];
      if (!part) return;
      // Snap a loose part into its socket when released close enough to the target.
      if (part.status === 'loose' &&
          Math.hypot(...part.position.map((value, i) => value - part.target[i])) < .13) {
         part.position = part.target.slice();
         part.status = 'docked';
         buzz(hand, .75, 100);
      } else if (part.status === 'docked') {
         // Mark a docked part as welded after the trigger is held for 1.2 seconds.
         if (part.progress >= 1) {
            part.status = 'welded';
            part.weldedAt = model.time;
            buzz(hand, 1, 180);
            if (parts.every(item => item.status === 'welded')) allWeldedAt = model.time;
         }
         part.progress = 0;
      }
      part.grabbed = false;
      held[hand] = null;
      grabStart[hand] = null;
   };

   // Update part transforms, target feedback, and the success effect every frame.
   model.animate(() => {
      for (const hand of ['left', 'right']) beams[hand].update();
      const unfolded = allWeldedAt === null ? 0 : Math.min(1, (model.time - allWeldedAt) / 2);
      for (const part of parts) {
         // Apply the saved position and reset the animated child before adding motion.
         part.node.identity().move(part.position);
         part.animated.identity();
         if (part.status === 'welded' && part.kind === 'panel')
            part.animated.turnY((part.target[0] < 0 ? -1 : 1) * .22 * (1 - unfolded));
         // if (part.status === 'welded' && part.kind === 'dish')
         //    part.animated.turnZ(Math.sin(model.time * 1.6) * .18);
         // Remove a target marker shortly after its weld turns green.
         if (part.socket && part.status === 'welded' && model.time - part.weldedAt >= .8) {
            model.remove(part.socket);
            part.socket = null;
         }
         if (part.socket) {
            // Use blue, orange, and green to show loose, docked, and welded states.
            part.socket.color(part.status === 'welded' ? [.15, 1.3, .4] :
                              part.status === 'docked' ? [1.4, .8, .1] : [.15, .55, 1.2]);
            const radius = part.socketRadius * (part.status === 'docked' ? 1 + part.progress * .45 : 1);
            part.socket.identity().move(part.target[0], part.target[1], part.target[2] + .025)
                       .scale(radius);
         }
      }
      // Fade in a gently pulsing green ring after all three repairs are complete.
      const radius = .5 + .04 * Math.sin(model.time * 6);
      success.identity().move(center).scale(radius)
             .opacity(allWeldedAt === null ? 0 : unfolded * .7);
   });
};

// Clear this scene's controller callbacks when another scene is loaded.
export const deinit = () => {
   inputEvents.onPress = inputEvents.onDrag = inputEvents.onRelease = () => {};
};
