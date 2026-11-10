import { C, createGame, driveTruck } from './forklift.js';

export const dock = [.49, .065, 0];
export const gap = .065;
export const plateSize = [.088, .009, .111];
export const platePosition = deployed => deployed ? [0, -.009, 0] : [-.23, .009, .185];

export const createRound = () => ({
   ...createGame(),
   truck: [-.34, 0, 0],
   yaw: -Math.PI / 2,
   cargo: [-.34 + C.forkReach, C.pickupHeight, 0],
   bridge: false,
   dockReady: false,
});

const wheelFootprint = s => {
   const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
   return [-.076, .076].flatMap(x => [-.079, .094].map(z => [
      s.truck[0] + cos * x + sin * z,
      s.truck[2] - sin * x + cos * z,
   ]));
};

const overlapsGap = points =>
   points.some(([x]) => x > -gap) && points.some(([x]) => x < gap);

export const setBridge = (s, deployed) => {
   if (!overlapsGap(wheelFootprint(s))) s.bridge = deployed;
};

export const driveWarehouse = (s, throttle, steer, dt) => {
   const next = { ...s };
   driveTruck(next, throttle, steer, dt);
   const footprint = wheelFootprint(next);
   // shortcut: the trench blocks unsupported wheels; add rigid bodies if falling becomes part of play.
   if (overlapsGap(footprint) && (!s.bridge || footprint.some(([,z]) => Math.abs(z) > plateSize[2]))) return;
   Object.assign(s, next);
};
