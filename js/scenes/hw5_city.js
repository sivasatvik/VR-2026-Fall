import * as cg from '../render/core/cg.js';
import { joyStickState } from '../render/core/controllerInput.js';
import { AIQuery } from '../util/aiquery.js';
import { controls, text, hitBox, dragPoint } from '../util/hw5-ui.js';

// Full dimensions in meters; the rendered Clay primitives use half dimensions.
export const EXAMPLE_HOUSE = {
   x: -.4, z: -.3, width: .15, depth: .14, height: .16,
   roof: 'pyramid', color: [.8,.55,.3]
};

export const validateCity = (plan, example = EXAMPLE_HOUSE) => {
   if (!plan || !Array.isArray(plan.buildings))
      throw new Error('Return a buildings array with at most 64 buildings.');
   const buildings = [], skipped = [];
   plan.buildings.forEach((b, i) => {
      try {
         if (buildings.length >= 64)
            throw new Error('Building ' + i + ' exceeds the 64-building limit.');
         if (!b || !['x','z','width','depth','height'].every(key => Number.isFinite(b[key])))
            throw new Error('Building ' + i + ' needs finite dimensions and a position.');
         if (b.width < .06 || b.width > .25 || b.depth < .06 || b.depth > .25 || b.height < .06 || b.height > .6)
            throw new Error('Building ' + i + ' is outside the allowed size range.');
         if (Math.abs(b.x) + b.width/2 > .65 || Math.abs(b.z) + b.depth/2 > .55)
            throw new Error('Building ' + i + ' extends outside the tabletop.');
         if (Math.abs(b.x) < .07 + b.width/2 || Math.abs(b.z) < .06 + b.depth/2)
            throw new Error('Building ' + i + ' blocks a central road.');
         if (!['pyramid','flat'].includes(b.roof) || !Array.isArray(b.color) || b.color.length !== 3 ||
             !b.color.every(v => Number.isFinite(v) && v >= 0 && v <= 1))
            throw new Error('Building ' + i + ' needs a flat/pyramid roof and an RGB color.');

         // Check body footprints; include roof overhangs if exact clearance becomes part of the task.
         const conflict = [example, ...buildings].find(other =>
            Math.abs(b.x-other.x) < (b.width+other.width)/2+.01 &&
            Math.abs(b.z-other.z) < (b.depth+other.depth)/2+.01);
         if (conflict)
            throw new Error('Building ' + i + ' overlaps ' + (conflict === example ? 'the demonstrated house.' : 'an earlier accepted building.'));
         buildings.push({ x:b.x, z:b.z, width:b.width, depth:b.depth, height:b.height, roof:b.roof, color:b.color.slice() });
      } catch (error) {
         skipped.push({ index:i, reason:error.message });
      }
   });
   return { buildings, skipped };
};

let ui;
export const init = async model => {
   ui?.remove();
   let active = true, busy = false, example = { ...EXAMPLE_HOUSE, color: EXAMPLE_HOUSE.color.slice() };
   let city = { buildings: [] }, held = {}, editMode = 'auto', houses = [];
   const ai = new AIQuery();
   const origin = [0,1.02,-1.05];
   const table = model.add().move(origin);
   table.add('cube').move(0,-.035,0).scale(.68,.035,.58).color(.13,.24,.21);
   table.add('cube').move(0,.002,0).scale(.07,.002,.55).color(.12,.14,.17);
   table.add('cube').move(0,.002,0).scale(.65,.002,.06).color(.12,.14,.17);
   for (let i = -5; i <= 5; i++) {
      table.add('cube').move(0,.005,i*.095).scale(.003,.001,.023).color(.9,.8,.45);
      if (i !== 0) table.add('cube').move(i*.115,.005,0).scale(.025,.001,.003).color(.9,.8,.45);
   }
   const exampleRoot = table.add(), generated = table.add();
   const buildHouse = (root, b) => {
      const house = root.add(), body = house.add('cube').color(b.color);
      const roof = house.add(b.roof === 'pyramid' ? 'pyramidY' : 'cube').color(.65,.22,.16);
      const door = house.add('cube').color(.2,.15,.1);
      const windows = [-1,1].map(() => house.add('cube').color(.6,.88,1));
      const update = () => {
         house.identity().move(b.x,0,b.z);
         body.identity().move(0,b.height/2,0).scale(b.width/2,b.height/2,b.depth/2);
         roof.identity().move(0,b.height+(b.roof === 'pyramid' ? .035 : .008),0)
            .scale(b.width*.57,b.roof === 'pyramid' ? .035 : .008,b.depth*.57);
         door.identity().move(0,.03,b.depth/2+.001).scale(.016,.03,.002);
         windows.forEach((node,i) => node.identity().move((i*2-1)*b.width*.3,b.height*.65,b.depth/2+.003).scale(b.width*.12,.018,.002));
      };
      update();
      return { b, body, roof, update };
   };
   let exampleHouse, exampleRing;
   const redrawExample = () => {
      while (exampleRoot.nChildren()) exampleRoot.remove(0);
      exampleHouse = buildHouse(exampleRoot, example);
      exampleRing = exampleRoot.add('ringY').move(example.x,.008,example.z).scale(.115).color(1,.8,.3);
      houses[0] = exampleHouse;
   };
   const redrawCity = () => {
      while (generated.nChildren()) generated.remove(0);
      houses = [exampleHouse,...city.buildings.map(b => buildHouse(generated,b))];
   };
   redrawExample();
   text(model, 'hw5CityHeading', 'TINY CITY / AI BUILD STUDIO', [-.63,1.87,-1.1], .85, [.5,.85,1]);
   text(model, 'hw5CityInstructions', 'Hold trigger on BODY to move / ROOF to resize.\nWhile holding BODY: thumbstick forward = farther,\nback = closer along beam. Touch + pinch also works.\nGold ring = example. Ask AI to build variations.', [-.63,1.76,-1.1], .48);
   ui = controls(model, 'hw5-city-controls', 'Tiny city builder', [.98,1.7,-1.05]);
   const ownUI = ui;
   const history = [];
   const setStatus = message => { if (active) ownUI.status(message); };

   const ask = async prompt => {
      if (busy || !active) return;
      if (typeof prompt !== 'string' || !prompt.trim()) return;
      busy = true;
      setStatus('AI is building...');
      const entry = { prompt: prompt.trim(), example: JSON.parse(JSON.stringify(example)) };
      history.push(entry);
      try {
         const response = await ai.askAI('', {
            response_format: { type: 'json_object' },
            messages: [
               { role:'system', content:
                  `You build a tiny city from a demonstrated house. Return ONLY one JSON object: {"buildings":[...]}.
No markdown, comments, explanations, or extra fields. Every building must have:
{"x":0.25,"z":0.20,"width":0.12,"depth":0.12,"height":0.16,"roof":"pyramid","color":[0.8,0.55,0.3]}.

MANDATORY LIMITS. All measurements are LOCAL meters. x,z are footprint CENTER coordinates;
width,depth,height are FULL dimensions, not half dimensions. Ground is y=0; do not output y.
Do not add the VR scene origin or convert values to centimeters.
1. Output at most 64 buildings. All numeric fields must be finite numbers, never strings.
2. 0.06 <= width <= 0.25; 0.06 <= depth <= 0.25; 0.06 <= height <= 0.60.
3. Entire footprint inside table: abs(x) + width/2 <= 0.65 AND abs(z) + depth/2 <= 0.55.
   Equivalently: -0.65+width/2 <= x <= 0.65-width/2;
   -0.55+depth/2 <= z <= 0.55-depth/2. Leave an extra 0.01 m inside the edges when possible.
4. BOTH crossing roads must stay clear: abs(x) >= 0.07+width/2 AND abs(z) >= 0.06+depth/2.
   Passing only one of these checks is NOT enough. Buildings cannot stand on either road.
5. Every pair A,B must satisfy AT LEAST ONE separation rule:
   abs(A.x-B.x) >= (A.width+B.width)/2 + 0.01 OR
   abs(A.z-B.z) >= (A.depth+B.depth)/2 + 0.01.
   This rule applies to ALL output pairs AND every output building versus demonstratedHouse.
   Aim for 0.02 m gaps to avoid rounding problems. Height differences do not prevent overlap.
6. roof must be "pyramid" or "flat". color must be exactly three numbers, each from 0 to 1.
7. demonstratedHouse already exists and must NOT appear in your output. Use its CURRENT
   position and dimensions from the user message when checking rule 5; it may have been moved.
8. Return the COMPLETE resulting buildings array. Preserve currentCity buildings unless asked
   to replace them; when adding N buildings, include the existing ones plus N new ones.
   For a replacement request for N buildings, return exactly N when they fit these limits.

NUMERIC EXAMPLES:
- width=0.12 requires abs(x)<=0.59. x=0.60 is INVALID: 0.60+0.06=0.66 > 0.65.
- depth=0.14 requires abs(z)>=0.13 for road clearance. z=-0.06 is INVALID.
- Two depth=0.14 buildings in the same column need center spacing >=0.15 along z.
  z=-0.26 and z=-0.34 are INVALID together: their separation is only 0.08.

For a replacement of 12 houses, prefer width=0.12 and depth=0.12 and use these 12
center pairs, varying heights, colors, and roofs from the demonstration:
[[-0.50,0.20],[-0.25,0.20],[0.25,0.20],[0.50,0.20],
 [-0.50,0.40],[-0.25,0.40],[0.25,0.40],[0.50,0.40],
 [0.25,-0.20],[0.50,-0.20],[0.25,-0.40],[0.50,-0.40]].
This grid clears the DEFAULT demonstrated house. Check every pair against the CURRENT
one and adjust any conflicting positions. Other counts/layouts must obey the same limits.
Reuse the demonstrated cube body, roof, door, and windows through parameter variations.

Before returning JSON, silently verify dimensions, both table edges, BOTH road clearances,
every building pair, the current demonstrated house, and the requested building count.
Revise any failing positions BEFORE responding. Output only the final checked JSON.` },
               { role:'user', content: JSON.stringify({ request:prompt, demonstratedHouse:example,
                  demonstrationRecipe:'cube body, pyramid/flat roof, cube door, two cube windows', currentCity:city }) }
            ]
         });
         const { buildings, skipped } = validateCity(JSON.parse(response), example);
         entry.skipped = skipped;
         if (!buildings.length && skipped.length)
            throw new Error('No valid buildings in response. Skipped ' + skipped.length + '. ' + skipped[0].reason);
         if (!active) return;
         city = { buildings };
         held = {};
         entry.result = JSON.parse(JSON.stringify(city));
         redrawCity();
         setStatus('AI built ' + buildings.length + ' buildings.' + (skipped.length
            ? ' Skipped ' + skipped.length + '. ' + skipped[0].reason
            : ' Try another variation.'));
      } catch (error) {
         entry.error = error.message;
         setStatus('City kept. ' + error.message);
      } finally { busy = false; }
   };
   ui.button('AI: make a neighborhood', () => ask('Replace the current city with 12 houses based on my demonstrated house. Vary colors and heights; use tidy rows.'));
   ui.button('AI: add a downtown', () => ask('Add 6 taller flat-roof towers in available spaces. Keep existing buildings and both roads clear.'));
   ui.button('AI: try a dense city', () => ask('Replace the generated city with 32 varied buildings. Keep roads clear and avoid all overlaps.'));
   const modeLabel = ui.button('Grab: body moves / roof resizes', () => {
      editMode = editMode === 'auto' ? 'move' : editMode === 'move' ? 'height' : 'auto';
      modeLabel(editMode === 'auto' ? 'Grab: body moves / roof resizes' : 'Grab: ' + editMode);
   });
   ui.button('Reset to example', () => {
      if (busy) return;
      city = { buildings: [] }; houses = []; held = {};
      example = { ...EXAMPLE_HOUSE, color:EXAMPLE_HOUSE.color.slice() };
      redrawExample(); redrawCity(); setStatus('Only your example remains.');
   });
   const form = document.createElement('form');
   const input = document.createElement('input');
   input.placeholder = 'Describe your city or an edit...';
   input.setAttribute('aria-label', 'City request');
   input.style.cssText = 'width:95%;padding:8px;margin-top:12px;box-sizing:border-box;font:inherit';
   const submit = document.createElement('button');
   submit.textContent = 'Ask AI';
   submit.style.font = 'inherit';
   form.append(input,submit);
   form.onsubmit = event => { event.preventDefault(); ask(input.value); };
   ui.desktop.append(form);
   window.askTinyCity = ask;
   window.tinyCity = { history, get plan() { return city; }, get example() { return example; } };
   const refreshInstructions = () => setStatus('Grab a body; thumbstick forward/back moves it along the beam. Then ask AI to build. OpenRouter first; Ollama fallback.');
   refreshInstructions();
   // Desktop can demonstrate the same height edit without a headset.
   const height = document.createElement('input');
   height.type = 'range'; height.min = '.06'; height.max = '.6'; height.step = '.01'; height.value = example.height;
   height.setAttribute('aria-label', 'Example house height');
   height.oninput = () => { if (!busy) { example.height = Number(height.value); exampleHouse.update(); } };
   const heightLabel = document.createElement('label');
   heightLabel.textContent = 'Example house height '; heightLabel.append(height); ui.desktop.append(heightLabel);

   inputEvents.onPress = hand => {
      if (ownUI.press(hand) || busy) return;
      const hits = [];
      for (const house of houses) for (const part of ['roof','body']) {
         if (Object.values(held).some(grab => grab.house === house)) continue;
         const hit = hitBox(hand,house[part]);
         if (hit) hits.push({ ...hit, house, part });
      }
      hits.sort((a,b) => a.distance-b.distance);
      if (hits.length) {
         const hit = hits[0];
         held[hand] = { ...hit, start:hit.point.slice(), original:{...hit.house.b},
            mode:editMode === 'auto' ? (hit.part === 'roof' ? 'height' : 'move') : editMode };
      }
   };
   const dragHouse = hand => {
      if (!held[hand] || busy) return;
      const grab = held[hand], p = dragPoint(hand,grab);
      if (!p) return;
      const b = grab.house.b;
      if (grab.mode === 'height') b.height = cg.clamp(grab.original.height+p[1]-grab.start[1], .06,.6);
      else {
         let x = cg.clamp(grab.original.x+p[0]-grab.start[0],-.65+b.width/2,.65-b.width/2);
         let z = cg.clamp(grab.original.z+p[2]-grab.start[2],-.55+b.depth/2,.55-b.depth/2);
         if (Math.abs(x) < .07+b.width/2) x = Math.sign(x || b.x)*(.07+b.width/2);
         if (Math.abs(z) < .06+b.depth/2) z = Math.sign(z || b.z)*(.06+b.depth/2);
         if (!houses.some(h => h.b !== b && Math.abs(x-h.b.x)<(b.width+h.b.width)/2+.01 && Math.abs(z-h.b.z)<(b.depth+h.b.depth)/2+.01)) {
            b.x=x; b.z=z;
         }
      }
      height.value = example.height;
      grab.house.update();
      exampleRing.identity().move(example.x,.008,example.z).scale(.115);
   };
   inputEvents.onDrag = dragHouse;
   inputEvents.onRelease = hand => { delete held[hand]; };
   inputEvents.onClick = () => {};
   let lastTime;
   model.animate(() => {
      const dt = lastTime === undefined ? 0 : cg.clamp(model.time-lastTime,0,.05);
      lastTime = model.time;
      for (const [hand,grab] of Object.entries(held)) {
         if (!grab.ray || grab.mode !== 'move' || window.handtracking || busy) continue;
         const stick = joyStickState[hand]?.y;
         if (Number.isFinite(stick) && Math.abs(stick) > .15) {
            grab.distance = cg.clamp(grab.distance-stick*1.2*dt,.25,8);
            dragHouse(hand);
         }
      }
   });
   ownUI.remove = (() => {
      const remove = ownUI.remove;
      return () => { active = false; remove(); };
   })();
};

export const deinit = () => {
   ui?.remove();
   delete window.askTinyCity;
   delete window.tinyCity;
   inputEvents.onPress = inputEvents.onDrag = inputEvents.onRelease = inputEvents.onClick = () => {};
};
