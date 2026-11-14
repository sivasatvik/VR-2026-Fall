import * as cg from '../render/core/cg.js';
import { G2 } from '../util/g2.js';

const parts = [
   { name: 'Head',      p: [0,.34,0],       size: [.16,.13,.13],  apart: [0,.24,0],       card: [.91,1.94,.2] },
   { name: 'Torso',     p: [0,0,0],         size: [.21,.20,.12],  apart: [0,0,.08],       card: [-.91,1.94,.2] },
   { name: 'Left arm',  p: [-.30,0,0],      size: [.075,.20,.08],apart: [-.24,.02,0],   card: [-.91,1.51,.2] },
   { name: 'Right arm', p: [.30,0,0],       size: [.075,.20,.08],apart: [.24,.02,0],    card: [.91,1.51,.2] },
   { name: 'Left leg',  p: [-.115,-.37,0],  size: [.085,.16,.09],apart: [-.10,-.18,0],  card: [-.91,1.08,.2] },
   { name: 'Right leg', p: [.115,-.37,0],   size: [.085,.16,.09],apart: [.10,-.18,0],   card: [.91,1.08,.2] },
];
const maxNote = 160;
const freshState = () => ({ selected: 0, yaw: -.25, pitch: 0, exploded: false, editing: false, notes: parts.map(() => '') });
const validState = s => s && Number.isInteger(s.selected) && s.selected >= 0 && s.selected < parts.length
   && Number.isFinite(s.yaw) && Number.isFinite(s.pitch) && Math.abs(s.pitch) <= .65
   && typeof s.exploded === 'boolean' && Array.isArray(s.notes) && s.notes.length === parts.length
   && (s.editing === undefined || typeof s.editing === 'boolean')
   && s.notes.every(note => typeof note === 'string' && note.length <= maxNote);

let cleanup = () => {};
export const deinit = () => cleanup();

export const init = async (model, ctx, ctxForever = {}) => {
   if (ctxForever.inspectAnnotateCleanup) ctxForever.inspectAnnotateCleanup();
   cleanup();
   // Place the smaller workbench beyond the laptop, with its stand at desk height.
   model.identity().move(0,.30,-.85).scale(.7);
   if (!validState(window.inspectAnnotateState)) window.inspectAnnotateState = freshState();
   let state = window.inspectAnnotateState;
   state.editing ??= false;
   let editing = -1, drag = null, dirty = false, spread = state.exploded ? 1 : 0;

   // An offscreen native field preserves cursor movement, paste, and IME without a desktop overlay.
   const textarea = document.createElement('textarea');
   textarea.id = 'inspect-annotate-note';
   textarea.setAttribute('aria-label', 'Component note');
   textarea.maxLength = maxNote;
   textarea.tabIndex = -1;
   textarea.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;';
   document.body.append(textarea);
   const changed = () => {
      window.inspectAnnotateState = state;
      dirty = true;
   };
   const finishEditing = () => {
      editing = -1;
      state.editing = false;
      textarea.blur();
      changed();
   };
   const startEditing = () => {
      editing = state.selected;
      state.editing = true;
      drag = null;
      textarea.setAttribute('aria-label', `${parts[editing].name} note (up to ${maxNote} characters)`);
      textarea.value = state.notes[editing];
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      changed();
   };
   const select = step => {
      state.selected = (state.selected + step + parts.length) % parts.length;
      changed();
   };
   const toggleExplode = () => { state.exploded = !state.exploded; changed(); };
   textarea.oninput = () => {
      if (editing < 0) return;
      state.notes[editing] = textarea.value.replace(/[\r\n\t]/g, ' ').slice(0, maxNote);
      changed();
   };
   // Keep native editing (paste, selection, IME) out of the classroom's keyboard shortcuts.
   textarea.addEventListener('keydown', e => {
      e.stopPropagation();
      if (editing >= 0 && !e.isComposing && (e.key === 'Enter' || e.key === 'Escape')) {
         e.preventDefault();
         finishEditing();
      }
   });
   textarea.addEventListener('keyup', e => e.stopPropagation());

   const previousHandlers = {};
   const handlers = {
      keydown: e => {
         if (editing >= 0 || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
         if (!['ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(e.key)) return;
         e.preventDefault();
         if (e.repeat) return;
         if (e.key === 'ArrowLeft') select(-1);
         if (e.key === 'ArrowRight') select(1);
         if (e.key === 'Enter') startEditing();
         if (e.key === ' ') toggleExplode();
      },
      keyup: () => {},
      mousedown: e => { if (e.button === 0 && editing < 0) drag = [e.clientX, e.clientY]; },
      mouseup: () => drag = null,
      mousemove: e => {
         if (!drag) return;
         if (!(e.buttons & 1)) { drag = null; return; }
         state.yaw = (state.yaw + .006 * (e.clientX - drag[0])) % (2 * Math.PI);
         state.pitch = cg.clamp(state.pitch + .006 * (e.clientY - drag[1]), -.65, .65);
         drag = [e.clientX, e.clientY];
         changed();
      },
   };
   for (const name in handlers) {
      previousHandlers[name] = window[name];
      window[name] = handlers[name];
   }
   const previousMode = window.interactMode;
   window.interactMode = 4;
   const releaseDrag = () => drag = null;
   window.addEventListener('blur', releaseDrag);
   window.addEventListener('mouseup', releaseDrag);

   const panel = (slot, position, size, width = 768, height = 384) => {
      const g2 = new G2(false, width, height);
      model.txtrSrc(slot, g2.getCanvas());
      const node = model.add('square').label('inspectPanel' + slot)
         .move(position).scale(...size, 1).txtr(slot).dull();
      return { node, ctx: g2.getCanvas().getContext('2d'), zoom: 1 };
   };
   const title = panel(8, [0,2.39,.05], [1.12,.16], 1536, 220);
   title.ctx.fillStyle = '#101e2a';
   title.ctx.fillRect(0,0,1536,220);
   title.ctx.textAlign = 'center';
   title.ctx.fillStyle = '#65e1da';
   title.ctx.font = 'bold 62px system-ui';
   title.ctx.fillText('INSPECT & ANNOTATE',768,84);
   title.ctx.fillStyle = '#eef7ff';
   title.ctx.font = '38px system-ui';
   title.ctx.fillText('DRAG: ROTATE    ARROWS: SELECT',768,143);
   title.ctx.fillText('ENTER: NOTE    SPACE: EXPLODE',768,192);

   model.add('cube').move(0,.65,0).scale(.70,.035,.35).color(.06,.11,.16);
   model.add('cube').move(0,.69,.27).scale(.64,.003,.003).color(.25,.9,.84).dull();
   const robot = model.add().label('inspectRobot');
   const bodies = [], cards = [], links = [], pins = [];
   const lastCards = [];
   parts.forEach((part, i) => {
      const body = robot.add().label('inspectPart' + i);
      bodies.push(body);
      body.add('cube,rounded').scale(part.size).color(.45,.57,.67);
      if (i === 0) {
         body.add('cube').move(0,.015,.133).scale(.125,.052,.01).color(.02,.05,.08);
         for (const x of [-.062,.062])
            body.add('sphere').move(x,.02,.146).scale(.022,.018,.008).color(.3,1,.88).dull();
      }
      if (i === 1) {
         body.add('cube').move(0,.015,.124).scale(.115,.11,.008).color(.05,.12,.17);
         for (const y of [-.045,0,.045])
            body.add('cube').move(0,y,.135).scale(.065,.007,.004).color(.25,.9,.84).dull();
      }
      if (i >= 2)
         body.add('sphere').move(0,part.size[1]-.025,0).scale(.06).color(.16,.24,.3);
      cards.push(panel(2 + i, part.card, [.32,.16]));
      links.push(model.add('tubeZ').label('inspectLink' + i).dull());
      pins.push(model.add('sphere').scale(.014).dull());
   });

   const drawCard = i => {
      const note = state.notes[i], selected = state.selected === i;
      const isEditing = selected && state.editing;
      const key = JSON.stringify([note, selected, isEditing]);
      if (lastCards[i] === key) return;
      lastCards[i] = key;
      const ctx = cards[i].ctx;
      ctx.fillStyle = selected ? '#193c4b' : '#101e2a';
      ctx.fillRect(0,0,768,384);
      ctx.fillStyle = selected ? '#65e1da' : '#5c7a8e';
      ctx.fillRect(0,0,8,384);
      ctx.font = 'bold 42px system-ui';
      ctx.fillText(`${String(i + 1).padStart(2,'0')}  ${parts[i].name.toUpperCase()}`,32,66);
      ctx.font = '28px system-ui';
      ctx.fillStyle = note ? '#eef7ff' : '#9db2c2';
      let line = '', y = 118;
      for (const char of note || 'No note yet. Select + press Enter.') {
         if (ctx.measureText(line + char).width > 700) {
            ctx.fillText(line,32,y);
            y += 32;
            line = '';
         }
         line += char;
      }
      ctx.fillText(line,32,y);
      ctx.font = 'bold 24px system-ui';
      ctx.fillStyle = selected ? '#65e1da' : '#9db2c2';
      ctx.fillText(isEditing ? 'EDITING · LIVE' : selected ? 'SELECTED · ENTER TO EDIT' : 'COMPONENT NOTE',32,352);
   };

   cleanup = () => {
      if (editing >= 0) finishEditing();
      if (dirty) server.broadcastGlobal('inspectAnnotateState');
      textarea.remove();
      window.removeEventListener('blur', releaseDrag);
      window.removeEventListener('mouseup', releaseDrag);
      for (const name in handlers)
         if (window[name] === handlers[name]) {
            if (previousHandlers[name] === undefined) delete window[name];
            else window[name] = previousHandlers[name];
         }
      if (window.interactMode === 4) window.interactMode = previousMode;
      delete ctxForever.inspectAnnotateCleanup;
      cleanup = () => {};
   };
   ctxForever.inspectAnnotateCleanup = cleanup;
   model.animate(() => {
      const shared = server.synchronize('inspectAnnotateState');
      if (validState(shared)) state = window.inspectAnnotateState = shared;
      else window.inspectAnnotateState = state;
      // shortcut: one computer drives the shared review; add edit ownership for simultaneous authors.
      if (dirty) { server.broadcastGlobal('inspectAnnotateState'); dirty = false; }
      if (editing >= 0 && state.selected !== editing) finishEditing();
      const dt = cg.clamp(model.deltaTime ?? 1 / 60, 0, .05);
      spread += ((state.exploded ? 1 : 0) - spread) * (1 - Math.exp(-9 * dt));
      robot.identity().move(0,1.4,0).turnY(state.yaw).turnX(state.pitch);
      parts.forEach((part, i) => {
         const position = cg.add(part.p, cg.scale(part.apart, spread));
         bodies[i].identity().move(position);
         bodies[i].child(0).color(state.selected === i ? [1,.65,.22] : [.45,.57,.67]);
         const from = cg.mTransform(robot.getMatrix(), cg.add(position, [0,0,part.size[2] + .02]));
         const card = cards[i];
         card.zoom += ((state.editing && state.selected === i ? 1.15 : 1) - card.zoom) * (1 - Math.exp(-12 * dt));
         card.node.identity().move(part.card).scale(.32 * card.zoom,.16 * card.zoom,1);
         const to = cg.add(part.card, [(part.card[0] < 0 ? .32 : -.32) * card.zoom, 0, -.01]);
         const color = state.selected === i ? [1,.65,.22] : [.27,.48,.57];
         links[i].identity().link(from,to,state.selected === i ? .003 : .0015).color(color);
         pins[i].identity().move(from).scale(.014).color(color);
         drawCard(i);
      });
   });
};
