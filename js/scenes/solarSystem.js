/* Grab a planet with a controller beam, then release it to create an orbit. */
import * as cg from '../render/core/cg.js';
import { ControllerBeam } from '../render/core/controllerInput.js';

export const init = async model => {
   // Store the sun center, controller beams, and the planet held by each hand.
   const center = [0, 1.42, -1.15];
   const beams = {
      left: new ControllerBeam(model, 'left'),
      right: new ControllerBeam(model, 'right'),
   };
   const held = { left: null, right: null };

   // Match Space Salvage's distant star shell so the view extends in every direction.
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

   // Add the sun and a short instruction label at the center of the activity.
   model.add('sphere').move(center).scale(.105).color(3, 1.7, .35).dull();
   model.add('label').info('Grab a planet. Drag it around the sun. Release to orbit.')
                     .move(0, 2.5, -1.15).scale(.028);

   // Keep the changing values together so they can be shared in a later assignment.
   const planets = [
      { name: 'Ember', color: [1.2, .34, .18], size: .052, speed: 1.1, tiltX: .4, tiltY: -.2, start: [-.35, .83, -1.05] },
      { name: 'Ocean', color: [.16, .62, 1.5], size: .07, speed: .75, tiltX: -.35, tiltY: .3, start: [0, .83, -1.25] },
      { name: 'Halo', color: [1.5, 1.1, .43], size: .064, speed: .55, tiltX: .5, tiltY: .15, start: [.35, .83, -.95] },
   ].map((data, index) => {
      // Nest plane, pivot, and body nodes so one hierarchy controls a tilted orbit.
      let orbitPlane = model.add();
      let pivot = orbitPlane.add();
      let body = pivot.add();
      body.add('sphere').scale(data.size).color(data.color);
      // Give Ocean a moon that rotates as a child of the planet.
      if (index === 1) {
         let moon = body.add();
         moon.add('sphere').move(.105, 0, 0).scale(.019).color(.85, .88, 1);
         data.moon = moon;
      }
      // Give Halo a visible ring around its body.
      if (index === 2)
         body.add('torusZ').turnX(.5).scale(.105, .105, .012).color(1, .8, .35);

      // Store the meshes, hit area, and changing orbit state for each planet.
      return { ...data, orbitPlane, pivot, body,
         hit: body.add().scale(data.size * 1.8),
         ring: orbitPlane.add('ringZ').color(data.color),
         position: data.start.slice(), radius: 0, angle: 0,
         orbiting: false, grabbed: false };
   });
   // Track the previous frame time so orbit speed stays frame-rate independent.
   let previousTime = null;

   // Send brief vibration feedback for grabbing and releasing a planet.
   const buzz = (hand, strength) => {
      if (!window.handtracking && typeof window.vibrate === 'function')
         window.vibrate(hand, strength, 55);
   };
   // Convert the controller beam into a scene-space origin and forward direction.
   const controllerPose = hand => {
      const m = beams[hand].beamMatrix();
      const inverse = cg.mInverse(window.worldCoords);
      const origin = cg.mTransform(inverse, m.slice(12, 15));
      const ahead = cg.mTransform(inverse, [m[12] - m[8], m[13] - m[9], m[14] - m[10]]);
      return { origin, direction: cg.normalize(cg.subtract(ahead, origin)) };
   };

   // Select the closest planet touched by the pressed controller beam.
   inputEvents.onPress = hand => {
      beams[hand].update();
      let closest = Infinity;
      for (const planet of planets) {
         if (planet.grabbed) continue;
         const hit = beams[hand].hitRect(planet.hit.getGlobalMatrix());
         if (hit && hit[2] < closest) {
            closest = hit[2];
            held[hand] = planet;
         }
      }
      if (held[hand]) {
         // Stop the current orbit and preserve the planet's beam depth for dragging.
         held[hand].grabbed = true;
         held[hand].orbiting = false;
         held[hand].position = held[hand].body.getGlobalPos();
         const pose = controllerPose(hand);
         held[hand].dragDepth = Math.max(.15,
            cg.dot(cg.subtract(held[hand].position, pose.origin), pose.direction));
         buzz(hand, .4);
      }
   };

   // Keep the grabbed planet on the controller beam while the hand moves.
   inputEvents.onDrag = hand => {
      const planet = held[hand];
      if (!planet) return;
      beams[hand].update();
      const pose = controllerPose(hand);
      planet.position = cg.add(pose.origin, cg.scale(pose.direction, planet.dragDepth));
   };

   // Project the released planet onto its tilted plane and start a new orbit.
   inputEvents.onRelease = hand => {
      const planet = held[hand];
      if (!planet) return;
      planet.orbitPlane.identity().move(center).turnX(planet.tiltX).turnY(planet.tiltY);
      // Convert the release point to orbit-plane coordinates to find radius and angle.
      const local = cg.mTransform(cg.mInverse(planet.orbitPlane.getGlobalMatrix()), planet.position);
      planet.radius = Math.max(.22, Math.min(.55, Math.hypot(local[0], local[1])));
      planet.angle = Math.atan2(local[1], local[0]);
      planet.orbiting = true;
      planet.grabbed = false;
      held[hand] = null;
      buzz(hand, .8);
   };

   // Update controller beams, planet orbits, rings, and the moon every frame.
   model.animate(() => {
      for (const hand of ['left', 'right']) beams[hand].update();
      const dt = previousTime === null ? 0 : Math.min(.05, Math.max(0, model.time - previousTime));
      previousTime = model.time;
      for (const planet of planets) {
         // Advance only planets that are orbiting and are not currently grabbed.
         if (planet.orbiting && !planet.grabbed) planet.angle += planet.speed * dt;
         if (planet.orbiting && !planet.grabbed) {
            // Rotate the pivot inside the tilted plane to move the body around the sun.
            planet.orbitPlane.identity().move(center).turnX(planet.tiltX).turnY(planet.tiltY);
            planet.pivot.identity().turnZ(planet.angle);
            planet.body.identity().move(planet.radius, 0, 0);
         } else {
            // Place a grabbed or waiting planet directly at its saved free position.
            planet.orbitPlane.identity().move(planet.position);
            planet.pivot.identity();
            planet.body.identity();
         }
         // Show a thin orbit path only after the planet has been released into orbit.
         planet.ring.identity().scale(planet.radius || .22)
                    .opacity(planet.orbiting ? .5 : 0);
         if (planet.moon) planet.moon.identity().turnZ(model.time * 2.5);
      }
   });
};

// Clear this scene's controller callbacks when another scene is loaded.
export const deinit = () => {
   inputEvents.onPress = inputEvents.onDrag = inputEvents.onRelease = () => {};
};
