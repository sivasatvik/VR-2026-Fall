import * as cg from '../render/core/cg.js';
import { lcb, rcb } from '../handle_scenes.js';

const ray = hand => {
   const beam = hand === 'left' ? lcb : rcb;
   if (!beam?.isEnabled || !beam.m) return null;
   const m = cg.mMultiply(cg.mInverse(worldCoords), beam.beamMatrix());
   return { origin:m.slice(12,15), direction:cg.normalize(cg.scale(m.slice(8,11),-1)) };
};

// Return room coordinates for both a near pinch and a distant controller-ray grab.
export const hitBox = (hand, node) => {
   const inverse = cg.mInverse(node.getMatrixFromRoot()), p = inputEvents.pos(hand);
   if (p && cg.mTransform(inverse,p).every(v => Math.abs(v) <= 1.2))
      return { point:p.slice(), ray:false, distance:0 };
   const r = ray(hand);
   if (!r) return null;
   const o = cg.mTransform(inverse,r.origin), d = cg.mTransform(inverse,[...r.direction,0]);
   let near = 0, far = Infinity;
   for (let i=0;i<3;i++) {
      if (Math.abs(d[i]) < 1e-8) { if (Math.abs(o[i]) > 1) return null; }
      else {
         const a = (-1-o[i])/d[i], b = (1-o[i])/d[i];
         near = Math.max(near,Math.min(a,b)); far = Math.min(far,Math.max(a,b));
      }
   }
   if (near > far || far < 0) return null;
   return { point:cg.add(r.origin,cg.scale(r.direction,near)), ray:true, distance:near };
};

export const dragPoint = (hand, grab, plane) => {
   if (!grab.ray) return inputEvents.pos(hand);
   const r = ray(hand);
   if (!r) return null;
   let distance = grab.distance;
   if (plane) {
      const inverse = cg.mInverse(plane.getMatrixFromRoot());
      const o = cg.mTransform(inverse,r.origin), d = cg.mTransform(inverse,[...r.direction,0]);
      if (Math.abs(d[2]) < 1e-8) return null;
      distance = -o[2]/d[2];
      if (distance < 0) return null;
   }
   return cg.add(r.origin,cg.scale(r.direction,distance));
};

// Reuse a named mesh so changing readouts do not accumulate text meshes.
export const text = (parent, name, value, position, scale = .45, color = [1,1,1]) => {
   let previous;
   clay.defineTextMesh(name, ' ');
   const node = parent.add(name).move(position).scale(scale * 1.4).color(color).dull();
   const set = value => {
      if (value !== previous) clay.defineTextMesh(name, previous = value, .005);
   };
   set(value);
   return { node, set };
};

export const controls = (model, id, title, position) => {
   document.getElementById(id)?.remove();
   const panel = document.createElement('section');
   panel.id = id;
   panel.setAttribute('aria-label', title);
   Object.assign(panel.style, {
      position: 'fixed', bottom: '16px', left: '16px', zIndex: 100,
      width: '380px', maxWidth: '85vw', maxHeight: '55vh', overflow: 'auto',
      padding: '16px', borderRadius: '12px', background: '#102033ee',
      color: '#fff', font: '600 17px/1.5 system-ui', boxShadow: '0 8px 30px #0006'
   });
   const heading = document.createElement('strong');
   heading.textContent = title;
   panel.append(heading);
   const desktop = document.createElement('div');
   panel.append(desktop);
   const status = document.createElement('p');
   status.setAttribute('role', 'status');
   panel.append(status);
   document.body.append(panel);

   const root = model.add().move(position);
   text(root, id + 'Title', title, [-.27,.14,0], .6, [.5,.85,1]);
   const readout = text(root, id + 'Status', 'Ready', [-.27,-.62,0], .42);
   const buttons = [];
   return {
      desktop,
      status(message) {
         status.textContent = message;
         readout.set(message.slice(0, 230).replace(/([^\n]{46})/g, '$1\n'));
      },
      button(label, action) {
         const row = root.add().move(0, -buttons.length * .115, 0);
         const face = row.add('cube').scale(.29,.043,.012).color(.12,.25,.38).dull();
         const caption = text(row, id + 'Button' + buttons.length, label, [-.265,.015,.016], .48);
         const element = document.createElement('button');
         element.type = 'button';
         element.textContent = label;
         Object.assign(element.style, { margin: '8px 6px 0 0', padding: '8px 10px', cursor: 'pointer', font:'inherit' });
         element.onclick = action;
         desktop.append(element);
         buttons.push({ face, action });
         return value => { element.textContent = value; caption.set(value); };
      },
      press(hand) {
         for (const { face, action } of buttons) {
            if (hitBox(hand,face)) {
               action();
               return true;
            }
         }
         return false;
      },
      remove() { panel.remove(); }
   };
};
