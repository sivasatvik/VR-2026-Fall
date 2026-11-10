export const C = {
   scale: 1 / 12, tableWidth: 1.524, tableDepth: .6096,
   minLift: .012, maxLift: .14, liftSpeed: .045, forkReach: .145,
   crateHalf: .035, pickupHeight: .018, dock: [.34, .065, -.065],
   driveSpeed: .08, turnSpeed: 1.2,
   grabMin: [-.095, -.025, -.22], grabMax: [.095, .225, .115],
};

export const createGame = () => ({
   truck: [-.32, 0, .08], yaw: 0, lift: C.minLift,
   cargo: [-.32, C.pickupHeight, -.065], attached: false, delivered: false,
});

export const forkPosition = s => [
   s.truck[0] - Math.sin(s.yaw) * C.forkReach,
   s.truck[1] + s.lift,
   s.truck[2] - Math.cos(s.yaw) * C.forkReach,
];

export const setTruckPose = (s, position, yaw = s.yaw, grounded = false) => {
   if (position?.length !== 3 || !position.every(Number.isFinite) || !Number.isFinite(yaw)) return;
   const xExtent = .07 * Math.abs(Math.cos(yaw)) + .21 * Math.abs(Math.sin(yaw));
   const zExtent = .07 * Math.abs(Math.sin(yaw)) + .21 * Math.abs(Math.cos(yaw));
   const clamp = (v, extent) => Math.max(-extent, Math.min(extent, v));
   s.truck = [clamp(position[0], C.tableWidth / 2 - xExtent),
              grounded ? 0 : Math.max(0, Math.min(.45, position[1])),
              clamp(position[2], C.tableDepth / 2 - zExtent)];
   s.yaw = yaw;
   if (s.attached) s.cargo = forkPosition(s);
};

export const setForkHeight = (s, height, dock = C.dock) => {
   if (!Number.isFinite(height)) return;
   const before = forkPosition(s);
   s.lift = Math.max(C.minLift, Math.min(C.maxLift, height));
   const after = forkPosition(s);
   const aligned = p => Math.hypot(after[0] - p[0], after[2] - p[2]) < .026;
   // shortcut: cargo snaps to the forks and dock; use rigid bodies for free stacking.
   if (!s.attached && !s.delivered && aligned(s.cargo) &&
       before[1] <= s.cargo[1] && after[1] > s.cargo[1]) s.attached = true;
   if (s.attached) {
      s.cargo = after.slice();
      if (dock && s.truck[1] === 0 && aligned(dock) && after[1] < before[1] &&
          before[1] >= dock[1] && after[1] <= dock[1]) {
         s.cargo = dock.slice();
         s.attached = false;
         s.delivered = true;
      }
   }
};

export const rayTruckDistance = (origin, direction) => {
   if (origin?.length !== 3 || direction?.length !== 3 ||
       ![...origin,...direction].every(Number.isFinite) || Math.hypot(...direction) < 1e-9) return null;
   let near=0, far=Infinity;
   for (let i=0;i<3;i++) {
      if (Math.abs(direction[i])<1e-9) {
         if (origin[i]<C.grabMin[i] || origin[i]>C.grabMax[i]) return null;
      } else {
         const a=(C.grabMin[i]-origin[i])/direction[i], b=(C.grabMax[i]-origin[i])/direction[i];
         near=Math.max(near,Math.min(a,b)); far=Math.min(far,Math.max(a,b));
         if (near>far) return null;
      }
   }
   return near;
};

export const driveTruck = (s, throttle, steer, dt) => {
   if (![throttle, steer, dt].every(Number.isFinite) || dt <= 0) return;
   throttle = Math.max(-1, Math.min(1, throttle));
   steer = Math.abs(steer) < .18 ? 0 : Math.max(-1, Math.min(1, steer));
   dt = Math.min(dt, .05);
   if (!throttle) return;
   const turn = -steer * throttle * C.turnSpeed * dt;
   const heading = s.yaw + turn / 2, distance = throttle * C.driveSpeed * dt;
   setTruckPose(s, [s.truck[0] - Math.sin(heading) * distance, 0,
                    s.truck[2] - Math.cos(heading) * distance], s.yaw + turn, true);
};
