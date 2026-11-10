import * as cg from '../render/core/cg.js';
import { buttonState, controllerMatrix, joyStickState } from '../render/core/controllerInput.js';
import { lcb, rcb } from '../handle_scenes.js';
import { G2 } from '../util/g2.js';
import { C, forkPosition, setForkHeight } from '../util/forklift.js';
import { createRound, dock, driveWarehouse, gap, platePosition, plateSize, setBridge } from '../util/warehouseRescue.js';

const channel = 'warehouseRescuePlayers';
const hands = ['left', 'right'];
const validMatrix = m => (Array.isArray(m) || ArrayBuffer.isView(m)) &&
   m.length === 16 && m.every(Number.isFinite);
const validPoint = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const validRound = s => s && validPoint(s.truck) && validPoint(s.cargo) &&
   Number.isFinite(s.yaw) && Number.isFinite(s.lift) &&
   ['attached', 'bridge', 'dockReady', 'delivered'].every(key => typeof s[key] === 'boolean');

export const init = async model => {
   window.warehouseRescueCleanup?.();
   window[channel] ??= {};
   const world = model.add().label('warehouseWorld');
   const truck = world.add().label('warehouseTruck');
   const box = (node, p, size, color) => node.add('cube').move(p).scale(size).color(color).dull();
   const dark = [.07,.10,.14], steel = [.36,.46,.55], yellow = [1,.65,.08];
   const green = [.19,.79,.43], cyan = [.12,.65,.95];
   const deckWidth = C.tableWidth / 2 - gap;
   box(world,[0,-.78,0],[2,.025,2],dark);
   for (const side of [-1, 1]) {
      const x = side * (gap + deckWidth / 2);
      box(world,[x,-.025,0],[deckWidth/2,.025,C.tableDepth/2],steel);
      for (const z of [-.295,.295]) box(world,[x,.004,z],[deckWidth/2,.004,.006],yellow);
      for (const z of [-.20,.20])
         box(world,[x,-.40,z],[.024,.35,.024],dark);
   }
   box(world,[0,-.16,0],[gap,.02,C.tableDepth/2],dark);
   for (const x of [-gap-.008,gap+.008])
      for (let i = -5; i <= 5; i++)
         box(world,[x,.001,i*.052],[.007,.001,.016],yellow);

   const bridge = world.add().label('warehouseBridge');
   const plate = box(bridge,[0,0,0],plateSize,cyan);
   for (const z of [-.097,.097]) box(bridge,[0,.009,z],[.081,.001,.004],yellow);
   for (const z of [-.117,.117]) box(world,[0,-.015,z],[.085,.005,.004],cyan);
   for (const x of [-.03,.03])
      box(world,[-.34+C.forkReach,.009,x],[.036,.009,.004],yellow);

   const platform = world.add().label('warehouseDock').move(dock[0],dock[1]/2,dock[2]);
   const dockSize = [.085,dock[1]/2,.063];
   const dockTop = box(platform,[0,0,0],dockSize,green);
   for (const z of [-.055,.055])
      box(platform,[0,dockSize[1]+.001,z],[.081,.001,.003],yellow);
   const targets = { bridge: { node: bridge, size: plateSize }, dockReady: { node: platform, size: dockSize } };
   for (const target of Object.values(targets)) {
      const [x,y,z] = target.size;
      target.face = cg.mMultiply(cg.mTranslate(0,y,0),
         cg.mMultiply(cg.mRotateX(-Math.PI/2),cg.mScale(x,z,1)));
   }

   box(truck,[0,.035,.015],[.056,.019,.076],yellow);
   box(truck,[0,.070,.075],[.054,.038,.026],yellow);
   box(truck,[0,.058,.022],[.032,.004,.034],dark);
   for (const x of [-.064,.064]) for (const z of [-.052,.067]) {
      truck.add('tubeX').move(x,.027,z).scale(.012,.027,.027).color(dark).dull();
      truck.add('tubeX').move(x*1.18,.027,z).scale(.002,.012,.012).color(steel).dull();
   }
   for (const x of [-.047,.047]) {
      box(truck,[x,.115,.065],[.004,.065,.004],steel);
      box(truck,[x,.105,-.080],[.005,.100,.006],dark);
      box(truck,[x,.183,.015],[.004,.006,.072],yellow);
   }
   for (const z of [-.054,.084]) box(truck,[0,.183,z],[.060,.006,.004],yellow);
   const forks = truck.add().label('warehouseForks');
   box(forks,[0,.019,-.088],[.052,.019,.008],steel);
   for (const x of [-.016,.016]) box(forks,[x,-.003,-C.forkReach],[.006,.003,.061],steel);
   box(truck,[.039,.068,.002],[.012,.008,.025],dark);
   box(truck,[.039,.096,.002],[.004,.025,.004],steel);
   const lever = truck.add().label('warehouseLever');
   box(lever,[0,-.009,0],[.003,.009,.003],steel);
   const leverKnob = lever.add('sphere').scale(.009).dull();
   const leverTravel = .04;
   const liftRange = C.maxLift - C.minLift;
   const cargo = world.add().label('warehouseCargo');
   box(cargo,[0,C.crateHalf,0],[C.crateHalf,C.crateHalf,C.crateHalf],[.72,.45,.20]);
   for (const x of [-.027,.027])
      box(cargo,[x,.035,.036],[.003,.035,.002],[.96,.71,.38]);

   const partner = world.add().label('warehousePartner');
   const head = partner.add().label('warehousePartnerHead');
   head.add('sphere').scale(.085,.10,.085).color([.95,.65,.40]).dull();
   box(head,[0,.012,-.075],[.074,.037,.025],[.04,.23,.31]);
   const controllers = hands.map(hand => {
      const node = partner.add().label('warehousePartner-' + hand);
      box(node,[0,0,0],[.025,.025,.055],hand === 'left' ? cyan : yellow);
      return node;
   });
   const avatarNodes = [head, ...controllers];

   const panel = model.add().label('warehouseInstructions');
   const graphics = new G2(false, 1024, 256);
   const canvas = graphics.getCanvas(), ctx = graphics.getContext();
   model.txtrSrc(7, canvas);
   panel.add('square').scale(.45,.1125,1).txtr(7).dull();
   const hud = document.createElement('aside');
   hud.id = 'warehouse-controls';
   hud.setAttribute('role', 'status');
   hud.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:10;max-width:34em;padding:12px 16px;' +
      'background:#0b1722;color:#fff;border-left:4px solid #48c7ff;font:600 15px/1.45 system-ui;white-space:pre-line';
   document.body.append(hud);

   let s = createRound(), role, pair, reference, tableHeight = .76;
   let lastVR, lastFrame = model.time, lastSend = -Infinity, statusText, lastReset = false;
   let grab, requests = {}, seenRequests = {};
   let joined = false;
   let requestNumber = 0;
   const keys = new Set(), packets = new Map();

   const tableMatrix = () => cg.mTranslate(0,tableHeight,-.65);
   const yawOf = m => Math.atan2(m[8],m[10]);
   const headPose = immersive => {
      const head = immersive && clientState.head(window.clientID);
      if (validMatrix(head)) return head;
      const views = window.views;
      return views?.length ? cg.mMultiply(clay.inverseRootMatrix, cg.mInverse(views[0].viewMatrix)) :
         cg.mTranslate(0,1.6,.35);
   };
   const driverMap = head => {
      reference ??= {
         floor: [head[12], lastVR ? clay.inverseRootMatrix[13] : head[13] - 1.55, head[14]],
         yaw: yawOf(head),
      };
      const cab = cg.mMultiply(cg.mTranslate(s.truck), cg.mRotateY(s.yaw));
      return cg.mMultiply(cab, cg.mMultiply(cg.mTranslate(0,0,.025), cg.mMultiply(cg.mScale(C.scale),
         cg.mMultiply(cg.mRotateY(-reference.yaw), cg.mTranslate(reference.floor.map(v => -v))))));
   };
   const setPose = (node, pose) => node.setMatrix(validMatrix(pose) ? pose : cg.mScale(0));
   const requestChange = key => {
      requests[key] = { number: ++requestNumber, active: !s[key] };
      lastSend = -Infinity;
   };
   const targetFor = hand => {
      const p = clientState.finger(window.clientID, hand, 1);
      const beam = hand === 'left' ? lcb : rcb;
      const canPoint = !window.handtracking && beam && validMatrix(controllerMatrix[hand]);
      if (canPoint) beam.update();
      for (const [key, {node, size, face}] of Object.entries(targets)) {
         if (key === 'dockReady' && s.delivered) continue;
         if (validPoint(p)) {
            const local = cg.mTransform(cg.mInverse(cg.mMultiply(tableMatrix(),node.getMatrix())),p);
            if (local.every((v,i) => Math.abs(v) < size[i]+.03)) return key;
         }
         if (canPoint && beam.hitRect(cg.mMultiply(node.getGlobalMatrix(),face))) return key;
      }
   };
   const cabHand = hand => {
      const pose = clientState.hand(window.clientID,hand);
      if (!validMatrix(pose)) return null;
      const cab = cg.mMultiply(world.getMatrix(),truck.getMatrix());
      return cg.mTransform(cg.mInverse(cab),pose.slice(12,15));
   };
   const press = hand => {
      if (grab) return;
      if (role === 'operator') {
         const target = targetFor(hand);
         if (target) grab = {hand, target};
      } else if (role === 'driver' && lastVR) {
         const p = cabHand(hand);
         if (p && cg.distance(p,lever.getMatrix().slice(12,15)) < .010)
            grab = {hand, target:'lever', start:p[1], lift:s.lift};
      }
   };
   const release = hand => {
      if (grab?.hand !== hand) return;
      if (grab.target !== 'lever') requestChange(grab.target);
      grab = null;
   };
   const idle = () => {};
   const handlers = {
      onPress: press, onRelease: release, onMove: idle, onDrag: idle, onClick: idle, onDoublePress: idle,
   };
   const previousHandlers = Object.fromEntries(Object.keys(handlers).map(name => [name,inputEvents[name]]));
   Object.assign(inputEvents,handlers);
   const reset = () => {
      s = createRound();
      grab = null;
      lastSend = -Infinity;
   };
   const keydown = event => {
      if (window.isXR() || event.target.matches?.('input,textarea,select,[contenteditable]') ||
          event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      const allowed = role === 'operator' ? ['e','q','-','='] :
         role === 'driver' ? ['w','a','s','d','arrowup','arrowdown','r'] : [];
      if (!allowed.includes(key)) return;
      event.preventDefault();
      event.stopPropagation();
      keys.add(key);
      if (event.repeat) return;
      if (key === 'e') requestChange('bridge');
      if (key === 'q') requestChange('dockReady');
      if (key === 'r') reset();
      if (key === '-' || key === '=') tableHeight = Math.max(.5,Math.min(1.2,tableHeight+(key === '=' ? .01 : -.01)));
   };
   const keyup = event => {
      if (keys.delete(event.key.toLowerCase())) {
         event.preventDefault();
         event.stopPropagation();
      }
   };
   const clearInput = () => {
      grab = null;
      keys.clear();
   };
   window.addEventListener('keydown',keydown,true);
   window.addEventListener('keyup',keyup,true);
   window.addEventListener('blur',clearInput);

   const updateInstructions = (title, goal, controls) => {
      const text = [title, goal, controls].join('\n');
      if (text === statusText) return;
      statusText = text;
      hud.textContent = text;
      ctx.fillStyle = '#0b1722';
      ctx.fillRect(0,0,1024,256);
      ctx.fillStyle = '#48c7ff';
      ctx.fillRect(0,0,1024,8);
      ctx.font = 'bold 42px sans-serif';
      ctx.fillText(title,36,70,952);
      ctx.fillStyle = '#ffffff';
      ctx.font = '32px sans-serif';
      ctx.fillText(goal,36,140,952);
      ctx.fillText(controls,36,202,952);
   };

   model.animate(() => {
      const dt = Math.min(.05, Math.max(0, model.time - lastFrame || 0));
      lastFrame = model.time;
      const now = performance.now(), id = window.clientID;
      if (!joined && id !== undefined && server.socket?.readyState === 1) {
         server.broadcast('warehouseRescue:join');
         joined = true;
      }
      const roster = window.warehouseRescueRoster ?? [];
      const immersive = window.isXR();
      const head = headPose(immersive);
      for (const peer of roster) {
         const value = window[channel][peer];
         if (!value) packets.delete(peer);
         else if (packets.get(peer)?.value !== value) packets.set(peer, { value, time: now });
      }
      for (const peer of packets.keys()) {
         if (!roster.includes(peer)) packets.delete(peer);
      }
      const isPresent = peer => peer !== undefined && (peer === id || now - packets.get(peer)?.time < 4000);
      const [operator, driver] = roster;
      const nextPair = JSON.stringify([operator, driver]);
      const nextRole = !roster.includes(id) ? undefined : id === operator ? 'operator' : id === driver ? 'driver' : 'spectator';
      if (nextPair !== pair || nextRole !== role || lastVR !== immersive) {
         if (nextPair !== pair || nextRole !== role) {
            s = createRound();
            requests = {};
            seenRequests = {};
         }
         pair = nextPair;
         role = nextRole;
         lastVR = immersive;
         lastSend = -Infinity;
         reference = null;
         clearInput();
         panel.setMatrix(cg.mMultiply(cg.mTranslate(head.slice(12,15)),cg.mRotateY(yawOf(head))))
            .move(0,.29,-1.15);
         panel.child(0).ignore = !lastVR;
         hud.hidden = lastVR;
      }

      const paired = isPresent(operator) && isPresent(driver);
      if (role === 'driver' && paired) {
         const message = packets.get(operator)?.value;
         if (message?.pair === pair) {
            for (const key of Object.keys(targets)) {
               const request = message.requests?.[key];
               if (!Number.isInteger(request?.number) || typeof request.active !== 'boolean' ||
                   request.number === seenRequests[key]) continue;
               seenRequests[key] = request.number;
               if (key === 'bridge') setBridge(s, request.active);
               else if (!s.delivered) s.dockReady = request.active;
               lastSend = -Infinity;
            }
         }

         const restart = lastVR && !!buttonState.right[5]?.pressed;
         if (restart && !lastReset) reset();
         lastReset = restart;
         const axis = (value, deadzone = .18) => Number.isFinite(value) && Math.abs(value) >= deadzone ? value : 0;
         const throttle = lastVR ? -axis(joyStickState.right.y) : Number(keys.has('w')) - Number(keys.has('s'));
         const steer = lastVR ? axis(joyStickState.left.x) : Number(keys.has('d')) - Number(keys.has('a'));
         const up = lastVR ? hands.some(hand => buttonState[hand][0]?.pressed) : keys.has('arrowup');
         const down = lastVR ? hands.some(hand => buttonState[hand][1]?.pressed) : keys.has('arrowdown');
         const receivingDock = s.dockReady ? dock : null;
         if (grab?.target === 'lever') {
            const p = cabHand(grab.hand);
            if (p) setForkHeight(s, grab.lift + (p[1] - grab.start) * liftRange / leverTravel, receivingDock);
         } else {
            driveWarehouse(s, throttle, steer, dt);
            if (up !== down) setForkHeight(s, s.lift + (up ? 1 : -1) * C.liftSpeed * dt, receivingDock);
         }
      } else {
         const message = packets.get(driver)?.value;
         if (message?.pair === pair && validRound(message.game)) s = message.game;
      }

      // Tracking poses map into tabletop coordinates. The camera sees the inverse mapping.
      const mapping = role === 'driver' ? driverMap(head) : cg.mInverse(tableMatrix());
      world.setMatrix(cg.mInverse(mapping));
      truck.identity().move(s.truck).turnY(s.yaw);
      forks.identity().move(0,s.lift,0);
      lever.identity().move(.039,.077+leverTravel*(s.lift-C.minLift)/liftRange,.002);
      leverKnob.color(grab?.target === 'lever' ? green : [1,.28,.07]);
      bridge.identity().move(platePosition(s.bridge));
      platform.identity().move(dock[0],dock[1]/2,dock[2]).turnY(s.dockReady ? 0 : Math.PI/2);
      const targeting = lastVR && role === 'operator' ? hands.map(targetFor) : [];
      plate.color(grab?.target === 'bridge' ? yellow : targeting.includes('bridge') || s.bridge ? green : cyan);
      cargo.identity().move(s.cargo).turnY(s.attached ? s.yaw : 0);
      const [x,,z] = forkPosition(s);
      const linedUp = s.attached && Math.hypot(x-dock[0],z-dock[2]) < .026;
      dockTop.color(grab?.target === 'dockReady' ? yellow : targeting.includes('dockReady') ? cyan :
         !s.dockReady ? [.84,.36,.12] : s.delivered || linedUp ? [.5,1,.55] : green);

      const partnerId = role === 'driver' ? operator : driver;
      const remote = isPresent(partnerId) && packets.get(partnerId)?.value;
      avatarNodes.forEach((node,i) => setPose(node, remote?.pair === pair ? remote.poses?.[i] : null));

      if (role && now - lastSend >= 50) {
         const poses = [head, ...hands.map(hand => lastVR ? clientState.hand(id,hand) : null)]
            .map(pose => validMatrix(pose) ? cg.mMultiply(mapping,pose) : null);
         // Each client publishes its own poses. Only the driver publishes the round.
         window[channel][id] = { pair, poses, requests, game: role === 'driver' ? s : undefined };
         server.broadcastGlobalElement(channel,id);
         lastSend = now;
      }

      const goal = s.delivered ? 'DELIVERED. Driver can reset the round.' :
         linedUp && s.dockReady ? (s.lift < dock[1] ? 'Raise the crate above the dock, then lower it.' :
            'Forks lined up. Lower the crate onto the green dock.') :
         linedUp ? 'Ask the operator to turn the orange dock toward the lane.' :
         !s.attached ? 'Raise the forks to pick up the crate.' :
         !s.bridge ? 'Place the bridge plate over the trench.' : 'Cross the bridge and line up with the receiving dock.';
      if (role === 'spectator') {
         updateInstructions('WAREHOUSE RESCUE | SPECTATOR','Two players are already in the warehouse.','You are viewing the loading dock.');
      } else if (!role) {
         updateInstructions('WAREHOUSE RESCUE','Joining the warehouse…','');
      } else if (!paired) {
         updateInstructions('WAREHOUSE RESCUE','Waiting for another player to open Warehouse Rescue.',
            role === 'operator' ? 'You are the full-scale bridge operator.' : 'You are the miniature forklift driver.');
      } else if (role === 'driver') {
         updateInstructions('WAREHOUSE RESCUE | FORKLIFT DRIVER', goal, lastVR ?
            'Sticks drive/steer / Trigger up, grip down or drag red lever / B reset' :
            'W/S drive / A/D steer / Up/Down forks / R reset');
      } else {
         updateInstructions('WAREHOUSE RESCUE | BRIDGE OPERATOR', goal, lastVR ?
            'Point and tap trigger to move the plate or turn the dock.' :
            'E moves the bridge / Q turns the dock / - and = adjust table height.');
      }
   });

   window.warehouseRescueCleanup = () => {
      for (const name in handlers)
         if (inputEvents[name] === handlers[name]) inputEvents[name] = previousHandlers[name];
      window.removeEventListener('keydown',keydown,true);
      window.removeEventListener('keyup',keyup,true);
      window.removeEventListener('blur',clearInput);
      hud.remove();
   };
};

export const deinit = () => {
   window.warehouseRescueCleanup?.();
   delete window.warehouseRescueCleanup;
   if (server.socket?.readyState === 1) server.broadcast('warehouseRescue:leave');
   const id = window.clientID;
   if (id !== undefined) window[channel][id] = null;
};
