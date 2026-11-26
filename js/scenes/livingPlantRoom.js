import * as cg from '../render/core/cg.js';
import { buttonState, controllerMatrix } from '../render/core/controllerInput.js';
import { keyWentDown, KEY_G, KEY_ONE, KEY_W } from '../util/input_keyboard.js';

const INCH = .0254;
const HALF_WIDTH = 141.5 * INCH / 2;
const HALF_LENGTH = 199.5 * INCH / 2;
const HEIGHT = 94.5 * INCH;
const INSET = .065;
const LEAF = 'livingPlantLeaf';
const GREENS = [[.23,.51,.16], [.4,.66,.21], [.53,.75,.29], [.24,.55,.31]];
const ROOT_X = .43;
const FORK_Y = 1.64;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// The measured floor center is the scene origin. Wall normals face inward.
const walls = [
   { name: 'Far',  x: 0, z: -HALF_LENGTH, span: HALF_WIDTH,  yaw: 0,            normal: [0,0,1] },
   { name: 'Left', x: -HALF_WIDTH, z: 0,  span: HALF_LENGTH, yaw: Math.PI / 2,  normal: [1,0,0] },
   { name: 'Right',x: HALF_WIDTH, z: 0,   span: HALF_LENGTH, yaw: -Math.PI / 2, normal: [-1,0,0] },
   { name: 'Near', x: 0, z: HALF_LENGTH,  span: HALF_WIDTH,  yaw: Math.PI,      normal: [0,0,-1] },
];

function aimAtWall(origin, direction) {
   let hit = null;
   for (const wall of walls) {
      const facing = cg.dot(direction, wall.normal);
      if (facing >= -.001) continue;
      const distance = cg.dot(cg.subtract([wall.x,0,wall.z], origin), wall.normal) / facing;
      if (distance <= 0 || (hit && distance >= hit.distance)) continue;
      const point = cg.add(origin, cg.scale(direction, distance));
      const across = wall.normal[0] ? point[2] : point[0];
      if (Math.abs(across) <= wall.span && point[1] >= 0 && point[1] <= HEIGHT)
         hit = { wall, point, distance };
   }
   return hit;
}

function aimAtObject(origin, direction, objects) {
   let hit = null, nearest = Infinity;
   for (const object of objects) {
      const offset = cg.subtract(object.center, origin);
      const along = cg.dot(offset, direction);
      const gap = cg.dot(offset, offset) - along * along;
      const radius = object.radius ** 2;
      if (along < -object.radius || gap > radius) continue;
      const distance = Math.max(0, along - Math.sqrt(radius - gap));
      if (distance < nearest) {
         hit = object;
         nearest = distance;
      }
   }
   return hit;
}

function addLeaf(parent, color, matte) {
   const isNew = !clay.formMesh(LEAF);
   if (isNew) clay.defineMesh(LEAF, clay.createGrid(8, 12));
   const leaf = parent.add(LEAF).color(color).dull(matte);
   if (isNew) {
      leaf.setVertices((u, v) => {
         const theta = 2 * Math.PI * u;
         const width = Math.max(.007, Math.max(0, Math.sin(Math.PI * v)) ** .82 * (1.3 - .6 * v));
         const rib = Math.cos(theta);
         const shade = .68 + .32 * Math.abs(rib);
         return [width * Math.sin(theta), v, .34 * v * v + width * (.26 * rib), shade, 1, shade];
      });
   }
   return leaf;
}

function buildPlanter(parent, name, x, z, color, foliage) {
   const pot = parent.add().label(name).move(x, 0, z);
   pot.add('diskY').move(0,.011,0).scale(.25,1,.25).color(.13,.16,.13).dull();
   pot.add('tubeY').move(0,.026,0).scale(.232,.023,.232).color(.32,.22,.16).dull();
   for (let n = 0; n < 6; n++) {
      const radius = .164 + .009 * n;
      pot.add('tubeY').move(0,.051 + .042 * n,0).scale(radius,.022,radius)
         .color(cg.scale(color, .79 + .04 * n)).dull(.83);
   }
   pot.add('tubeY').move(0,.292,0).scale(.222,.025,.222).color(color).dull(.72);
   const soil = pot.add('diskY').move(0,.315,0).scale(.2,1,.2).color(.13,.09,.055).dull();
   const leaves = Array.from({ length: foliage === 'fern' ? 13 : 9 }, (_, i) => {
      const palette = foliage === 'oxalis' ? [[.38,.18,.31], [.57,.25,.37], [.69,.41,.49]] : GREENS;
      const stem = pot.add().move(0,.316,0).turnY(i * 2.39996);
      const blade = addLeaf(stem, palette[i % palette.length], .62);
      return { stem, blade };
   });
   return { center: [x,.37,z], target: [x,.32,z], radius: .29, moisture: .26, soil, leaves };
}

function samplePath(waypoints) {
   const points = [waypoints[0]];
   for (let section = 1; section < waypoints.length; section++) {
      const start = waypoints[section - 1], end = waypoints[section];
      const steps = Math.ceil(cg.distance(start, end) / .105);
      for (let i = 1; i <= steps; i++) {
         const point = cg.mix(start, end, i / steps);
         point[1] += .055 * Math.sin(2 * Math.PI * i / steps);
         points.push(point);
      }
   }
   return points;
}

function buildVine(parent, name, sections) {
   const group = parent.add().label(name);
   let offset = 0;
   const segments = [], limits = [];
   for (const { points, yaw } of sections) {
      const path = samplePath(points);
      for (let i = 1; i < path.length; i++) {
         const n = offset + i;
         const stem = group.add('tube12').color(.24,.39,.105).dull(.84).scale(0);
         const leaf = n % 2 ? null : addLeaf(group, GREENS[(n / 2 + name.length) % GREENS.length], .45 + .18 * (n % 3));
         if (leaf) leaf.scale(0);
         segments.push({ start: path[i - 1], end: path[i], stem, leaf, yaw });
      }
      offset = segments.length;
      limits.push(offset);
   }
   return { segments, limits, growth: 0, visibleSegments: 0 };
}

function drawVine(vine, time) {
   const count = Math.ceil(vine.growth);
   for (let i = 0; i < count; i++) {
      const amount = Math.min(1, vine.growth - i);
      const { start, end, stem, leaf, yaw } = vine.segments[i];
      if (i >= vine.visibleSegments - 1)
         stem.placeLimb(start, cg.mix(start, end, amount), Math.max(.006, .016 - i * .00013));
      if (leaf) {
         const side = i % 4 === 1 ? -1 : 1;
         const size = amount * (.84 + .16 * Math.sin(2.42 * i));
         leaf.identity().move(cg.mix(start, end, .8 * amount)).turnY(yaw)
            .turnZ(side * (.87 + .35 * Math.sin(i))).turnX(.32 + .11 * Math.sin(2 * time + i))
            .scale(.054 * size, .203 * size, .067 * size);
      }
   }
   vine.visibleSegments = count;
}

function drawPlaque(canvas, inXR, guides, light) {
   const ctx = canvas.getContext('2d');
   const text = (value, x, y, font, color) => {
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.fillText(value, x, y);
   };
   ctx.fillStyle = '#172e25';
   ctx.fillRect(0, 0, canvas.width, canvas.height);
   ctx.fillStyle = '#dfb774';
   ctx.fillRect(0, 0, 10, canvas.height);
   text('Living Plant Room', 43, 82, '55px Georgia', '#f7f0dc');
   text(inXR ? 'Hold trigger on the can. Aim at a planter.' : 'W  Water the planters     G  Toggle wall guides',
      45, 146, '26px sans-serif', '#d5e3cf');
   text(inXR ? 'Hold trigger on the lamp. Sweep it across a wall.' : '1–3  Aim at far, left, or right wall',
      45, 186, '26px sans-serif', '#d5e3cf');
   text(inXR ? 'Joysticks  Align room     X  Toggle guides' : '4 / 5  Aim at the left / right half of the near wall',
      45, 226, '26px sans-serif', '#d5e3cf');
   ctx.fillStyle = '#2b4438';
   ctx.fillRect(44, 261, 680, 2);
   text(light ? `${light.toUpperCase()} WALL LIT` : 'LAMP IDLE', 45, 313, 'bold 23px sans-serif', '#f4d998');
   text(guides ? 'GUIDES ON' : 'GUIDES OFF', 564, 313, 'bold 23px sans-serif', '#a5cbbc');
}

export const init = async model => {
   const room = model.add().label('livingPlantRoom');
   const guides = room.add().label('roomGuides');
   for (const { name, x, z, span, yaw } of walls) {
      const wall = guides.add().label(`${name} wall`).move(x, HEIGHT / 2, z).turnY(yaw);
      wall.add('square').label('wallPlane').scale(span, HEIGHT / 2, 1).color(.34,.64,.54).dull().opacity(.7);
      for (const y of [-HEIGHT / 2, HEIGHT / 2])
         wall.add('cube').move(0,y,.004).scale(span,.005,.004).color(.45,.82,.68).dull().opacity(.62);
      wall.add('cube').move(-span,0,.004).scale(.005,HEIGHT / 2,.004).color(.45,.82,.68).dull().opacity(.62);
   }

   const back = -HALF_LENGTH + INSET;
   const planters = [
      buildPlanter(room, 'climbingPlanter', ROOT_X, back + .23, [.68,.37,.23], 'ivy'),
      buildPlanter(room, 'fernPlanter', -HALF_WIDTH + .36, back + .39, [.31,.53,.46], 'fern'),
      buildPlanter(room, 'oxalisPlanter', HALF_WIDTH - .34, back + .64, [.65,.48,.32], 'oxalis'),
   ];
   const trunk = buildVine(room, 'climbingTrunk', [{ yaw: 0, points: [
      planters[0].target, [ROOT_X - .10,.57,back], [ROOT_X + .11,.9,back],
      [ROOT_X - .09,1.29,back], [ROOT_X,FORK_Y,back],
   ] }]);
   trunk.growth = 7;
   const front = HALF_LENGTH - INSET;
   const meetingPoint = [0,1.87,front];
   const runners = [-1, 1].map(side => {
      const cornerX = side * (HALF_WIDTH - INSET);
      return buildVine(room, side < 0 ? 'leftRunner' : 'rightRunner', [
         { yaw: 0, points: [[ROOT_X,FORK_Y,back], [side * .68,1.85,back], [cornerX,1.96,back]] },
         { yaw: -side * Math.PI / 2, points: [[cornerX,1.96,back], [cornerX,2.14,-1.36],
               [cornerX,1.87,.16], [cornerX,2.15,1.49], [cornerX,1.95,front]] },
         { yaw: Math.PI, points: [[cornerX,1.95,front], [side * .87,2.12,front], [side * .19,1.87,front], meetingPoint] },
      ]);
   });

   const plaque = room.add().move(-.65,1.38,back + .024);
   const canvas = document.createElement('canvas');
   canvas.width = 768;
   canvas.height = 352;
   plaque.add('cube').scale(.56,.267,.02).color(.39,.24,.13).dull();
   plaque.add('square').move(0,0,.021).scale(.539,.247,1).setTxtr(canvas).dull();
   plaque.add('cube').move(0,-.46,.16).scale(.51,.026,.21).color(.48,.28,.14).dull(.8);
   for (const x of [-.36,.36])
      plaque.add('cube').move(x,-.52,.08).scale(.022,.056,.079).color(.54,.37,.18).dull();

   const can = room.add().label('wateringCan');
   can.add('sphere12').move(0,-.018,0).scale(.093,.065,.071).color(.25,.58,.48).dull(.5);
   can.add('torusZ').move(0,.048,.02).scale(.051,.045,.021).color(.32,.67,.55).dull(.5);
   can.add('tube12').color(.31,.64,.53).placeLimb([0,-.02,-.035],[0,.015,-.143],.018);
   can.add('sphere12').move(0,.015,-.147).scale(.036,.029,.016).color(.68,.48,.25).dull(.45);

   const lamp = room.add().label('growLamp');
   lamp.add('sphere12').scale(.074,.067,.085).color(.65,.41,.19).dull(.43);
   lamp.add('tube12').move(0,0,-.043).scale(.079,.063,.05).color(.76,.54,.26).dull(.47);
   lamp.add('sphere12').move(0,0,-.088).scale(.072,.057,.019).color([1,.83,.43]).dull();
   lamp.add('tubeY').move(0,-.067,.043).scale(.024,.058,.025).color(.21,.28,.22).dull();

   const tools = [
      { node: can, center: [-.91,1.016,back + .235], radius: .16, tip: [0,.015,-.15] },
      { node: lamp, center: [-.40,1.055,back + .235], radius: .125, tip: [0,0,-.095] },
   ];
   const dockTool = tool => tool.node.identity().move(tool.center).turnY(tool === tools[0] ? 2 : 2.7);
   tools.forEach(dockTool);
   const spot = room.add().label('lampSpot').scale(0);
   spot.add('diskZ').scale(.25,.25,1).color(1,.73,.27).dull().opacity(.21);
   spot.add('torusZ').scale(.181,.181,.012).color(1,.77,.31).dull().opacity(.32);
   const stream = Array.from({ length: 10 }, () => room.add('sphere6').color(.47,.85,1).dull().scale(0));

   const hands = ['left', 'right'].map(name => ({ name, down: false, held: null }));
   const desktopTargets = walls.map(wall => ({ wall, point: [wall.x || -.9, 1.9, wall.z || -.48] }));
   desktopTargets.push({ wall: walls[3], point: [.9,1.9,HALF_LENGTH] });
   let showGuides = true, wasXDown = false, desktopLight = null, previewWaterUntil = 0, lastPlaque = '';

   model.animate(() => {
      const time = model.time, dt = clamp(model.deltaTime, 0, .06);
      const inXR = window.isXR();
      const xDown = inXR && !window.handtracking && buttonState.left[4]?.pressed;
      if ((xDown && !wasXDown) || (!inXR && keyWentDown(KEY_G))) showGuides = !showGuides;
      wasXDown = xDown;
      guides.identity().scale(showGuides ? 1 : 0);

      let light = null, watered = null, pourFrom = null;
      if (!inXR) {
         for (let i = 0; i < desktopTargets.length; i++) {
            if (keyWentDown(KEY_ONE + i)) desktopLight = desktopLight === desktopTargets[i] ? null : desktopTargets[i];
         }
         if (keyWentDown(KEY_W)) {
            for (const plant of planters) plant.moisture = 1;
            previewWaterUntil = time + 1.25;
         }
         light = desktopLight;
         if (time < previewWaterUntil) {
            watered = planters[0];
            pourFrom = [ROOT_X + .05,.86,back + .37];
         }
      }

      for (const hand of hands) {
         const controller = controllerMatrix[hand.name];
         const active = inXR && !window.handtracking && controller.length === 16;
         const down = active && !!buttonState[hand.name][0]?.pressed;
         if (!down && hand.held) {
            dockTool(hand.held);
            hand.held = null;
         }
         if (active) {
            // Match the class controller beam's offset and its grip-to-pointer tilt.
            const pose = cg.mMultiply(clay.inverseRootMatrix, cg.mMultiply(controller, cg.mRotateX(-Math.PI / 4)));
            const origin = cg.mTransform(pose, [0,.02,0]);
            const direction = cg.scale(pose.slice(8,11), -1);
            if (down && !hand.down) {
               const available = tools.filter(tool => !hands.some(other => other.held === tool));
               hand.held = aimAtObject(origin, direction, available);
            }
            if (hand.held) {
               const tool = hand.held;
               tool.node.setMatrix(pose).move(0,.02,-.15);
               const tip = cg.mTransform(tool.node.getMatrix(), tool.tip);
               if (tool === tools[1]) light = aimAtWall(tip, direction);
               else {
                  watered = aimAtObject(tip, direction, planters);
                  pourFrom = tip;
               }
            }
         }
         hand.down = down;
      }

      if (watered) watered.moisture = Math.min(1, watered.moisture + 1.25 * dt);
      for (let i = 0; i < stream.length; i++) {
         const drop = stream[i].identity();
         if (!watered) { drop.scale(0); continue; }
         const t = (time * 2.1 + i / stream.length) % 1;
         const p = cg.mix(pourFrom, watered.target, t);
         p[0] += .014 * Math.sin(i * 7);
         p[1] += .12 * t * (1 - t);
         drop.move(p).scale(.011,.017,.011);
      }

      spot.identity();
      if (light) {
         const { wall, point } = light;
         spot.move(cg.add(point, cg.scale(wall.normal, .014))).turnY(wall.yaw);
         const index = wall === walls[1] ? 0 : wall === walls[2] ? 1 : +(point[0] >= 0);
         const section = wall === walls[0] ? 0 : wall === walls[3] ? 2 : 1;
         const runner = runners[index];
         const vine = trunk.growth < trunk.limits[0] ? trunk : runner;
         const limit = vine === trunk ? trunk.limits[0] : runner.limits[section];
         const rootPot = planters[0];
         if (vine.growth < limit && rootPot.moisture > 0) {
            vine.growth = Math.min(limit, vine.growth + dt * (6 + 5 * rootPot.moisture));
            rootPot.moisture = Math.max(0, rootPot.moisture - .047 * dt);
         }
      } else spot.scale(0);

      for (const { leaves, soil, moisture } of planters) {
         soil.color(cg.mix([.18,.125,.08], [.084,.061,.039], moisture));
         leaves.forEach(({ stem, blade }, i) => {
            const lift = .58 + .11 * i + .14 * Math.sin(i * 2.8 + time * 1.75);
            const vigor = .68 + .33 * moisture + .16 * Math.sin(i * 2.17);
            stem.identity().move(0,.316,0).turnY(i * 2.39996).turnZ(lift);
            blade.identity().scale(.063 * vigor, (.34 + .08 * Math.sin(i)) * vigor, .069 * vigor);
         });
      }
      for (const vine of [trunk, ...runners]) drawVine(vine, time);

      const status = `${inXR}/${showGuides}/${light?.wall.name}`;
      if (status !== lastPlaque) {
         drawPlaque(canvas, inXR, showGuides, light?.wall.name);
         lastPlaque = status;
      }
   });
};
