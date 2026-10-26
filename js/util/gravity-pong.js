// Arena coordinates are relative to its center; paddles store [height, depth].
export const C = {
   halfWidth: 1.2, halfHeight: .55, halfDepth: .55,
   radius: .065, paddleRadius: .20, paddleX: 1.08,
};

export function createGame() {
   return {
      p: [0,0,0], v: [0,0,0], paddles: [[0,0],[0,0]],
      score: [0,0], shield: [0,0], cooldown: [0,0], power: [.5,.5],
      playing: false, winner: -1, solo: true, time: 0, eventID: 0, events: [], botHistory: [],
   };
}

function event(s, kind, pos = s.p) {
   s.events.push({ id: ++s.eventID, kind, pos: pos.slice() });
   if (s.events.length > 16) s.events.shift();
}

export function serve(s) {
   if (s.playing || s.winner >= 0) return false;
   s.p = [0,0,0];
   s.v = [(s.score[0] + s.score[1]) % 2 ? -1.3 : 1.3, .55, .28];
   s.botHistory = [];
   s.playing = true;
   event(s, 'serve');
   return true;
}

export function activateShield(s, side) {
   if ((side !== 0 && side !== 1) || s.cooldown[side] > 0) return false;
   s.shield[side] = 1.25;
   s.cooldown[side] = 8;
   return true;
}

export function reset(s) {
   Object.assign(s, {
      p: [0,0,0], v: [0,0,0], score: [0,0], shield: [0,0],
      cooldown: [0,0], playing: false, winner: -1, time: 0, botHistory: [],
   });
}

const clamp = (x, limit) => Math.max(-limit, Math.min(limit, x));

export function step(s, dt) {
   if (!Number.isFinite(dt) || dt <= 0) return;
   dt = Math.min(dt, .05);
   const count = Math.ceil(dt * 120), h = dt / count;
   const history = s.botHistory ||= [];
   for (let n = 0; n < count; n++) {
      s.time += h;
      for (let side = 0; side < 2; side++) {
         s.shield[side] = Math.max(0, s.shield[side] - h);
         s.cooldown[side] = Math.max(0, s.cooldown[side] - h);
      }
      if (!s.solo || !s.playing) history.length = 0;
      if (s.solo && s.playing) {
         // Remember 0.30 seconds of ball positions, sampled at most 120 times/second.
         if (!history.length || s.time - history[history.length-1][0] >= 1/120 - 1e-9)
            history.push([s.time, s.p[1], s.p[2]]);
         const cutoff = s.time - .30;
         while (history.length > 1 && history[1][0] <= cutoff) history.shift();
         if (history[0][0] <= cutoff)
            for (let a = 0; a < 2; a++)
               s.paddles[1][a] += clamp(history[0][a+1] - s.paddles[1][a], .65 * h);
      }
      for (const paddle of s.paddles) {
         paddle[0] = clamp(paddle[0], C.halfHeight - C.paddleRadius);
         paddle[1] = clamp(paddle[1], C.halfDepth - C.paddleRadius);
      }
      if (!s.playing) continue;

      const old = s.p.slice();
      s.v[1] -= .7 * h;
      for (let a = 0; a < 3; a++) s.p[a] += s.v[a] * h;

      for (let a = 1; a < 3; a++) {
         const edge = (a === 1 ? C.halfHeight : C.halfDepth) - C.radius;
         if (Math.abs(s.p[a]) > edge) {
            s.p[a] = clamp(s.p[a], edge);
            s.v[a] *= -1;
            event(s, 'wall');
         }
      }

      const side = s.v[0] < 0 ? 0 : 1, sign = side === 0 ? -1 : 1;
      const plane = sign * (C.paddleX - C.radius);
      // Test the crossed plane, so a fast ball cannot skip a thin paddle.
      if (sign * old[0] <= sign * plane && sign * s.p[0] >= sign * plane) {
         const t = (plane - old[0]) / (s.p[0] - old[0]);
         const y = old[1] + t * (s.p[1] - old[1]) - s.paddles[side][0];
         const z = old[2] + t * (s.p[2] - old[2]) - s.paddles[side][1];
         if (Math.hypot(y,z) < C.paddleRadius + C.radius) {
            const speed = Math.min(2.8, Math.max(1.3, Math.hypot(...s.v) * 1.04)
                                              * (.85 + .3 * s.power[side]));
            const dy = 3 * y + .18, dz = 3 * z;
            const vx = speed / Math.hypot(1,dy,dz);
            s.p[0] = plane;
            s.v = [-sign * vx, vx * dy, vx * dz];
            event(s, 'paddle');
         }
      }

      if (s.shield[side] > 0 && sign * s.p[0] >= C.halfWidth - C.radius
                             && sign * s.v[0] > 0) {
         s.p[0] = sign * (C.halfWidth - C.radius);
         s.v[0] *= -1;
         event(s, 'shield');
      }
      if (Math.abs(s.p[0]) >= C.halfWidth) {
         const scorer = s.p[0] < 0 ? 1 : 0;
         s.score[scorer]++;
         event(s, 'goal');
         if (s.score[scorer] >= 5) s.winner = scorer;
         s.playing = false;
         s.p = [0,0,0];
         s.v = [0,0,0];
      }
   }
}
