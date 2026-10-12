// Shared data and rules only. Rendering and controller input stay on each client.
export const CENTER = [0, 1.35, -1.65];
export const CHANNEL = 'alienSolarSystem';
export const TYPES = ['rocky', 'ocean', 'ice', 'volcanic', 'gas'];
// Texture IDs travel with system data; image files stay on each client.
export const PLANET_TEXTURES = {
   rocky: { type: 'rocky', name: 'Cratered Rock', file: 'rocky.jpg', description: 'Cratered gray terrain with rugged plains and ancient impact scars.' },
   ocean: { type: 'ocean', name: 'Blue Ocean', file: 'ocean.jpg', description: 'Deep blue oceans surround green continents and scattered clouds.' },
   ice: { type: 'ice', name: 'Pale Ice', file: 'ice.jpg', description: 'Pale frozen terrain mottled with darker icy regions.' },
   volcanic: { type: 'volcanic', name: 'Volcanic Terrain', file: 'volcanic.jpg', description: 'Rust-colored volcanic terrain with broad ridges and weathered plains.' },
   gas: { type: 'gas', name: 'Amber Giant', file: 'gas.jpg', description: 'Amber and cream cloud belts wrap around broad swirling storms.' },
   'obsidian-lava': { type: 'volcanic', name: 'Obsidian Lava', file: 'obsidian-lava.png', description: 'Black basalt plates split by narrow orange molten rivers and cooling ash fields.' },
   'sulfur-caldera': { type: 'volcanic', name: 'Sulfur Caldera', file: 'sulfur-caldera.png', description: 'Yellow sulfur deposits surround rust-red calderas and dark volcanic basins.' },
   'glacial-rifts': { type: 'ice', name: 'Glacial Rifts', file: 'glacial-rifts.png', description: 'Pale blue ice sheets fracture into deep teal fissures above a hidden ocean.' },
   'amethyst-frost': { type: 'ice', name: 'Amethyst Frost', file: 'amethyst-frost.png', description: 'Lavender frost plains meet white ridges and dark violet frozen basins.' },
   'turquoise-reefs': { type: 'ocean', name: 'Turquoise Reefs', file: 'turquoise-reefs.png', description: 'Turquoise shallows and pale coral atolls border a deep cobalt ocean.' },
   'emerald-archipelago': { type: 'ocean', name: 'Emerald Archipelago', file: 'emerald-archipelago.png', description: 'Emerald island chains and mossy continents divide deep sapphire seas.' },
   'copper-dunes': { type: 'rocky', name: 'Copper Dunes', file: 'copper-dunes.png', description: 'Copper dunes cross ochre deserts, dry channels, and ancient impact basins.' },
   'crystal-badlands': { type: 'rocky', name: 'Crystal Badlands', file: 'crystal-badlands.png', description: 'Charcoal rocky plains carry pale mineral veins and scattered blue crystal deposits.' },
   'violet-storms': { type: 'gas', name: 'Violet Storms', file: 'violet-storms.png', description: 'Violet and cream cloud belts curl into broad oval storm systems.' },
   'jade-bands': { type: 'gas', name: 'Jade Bands', file: 'jade-bands.png', description: 'Jade, teal, and silver cloud bands spiral around deep green storms.' },
};
export const PRESETS = [
   'A mysterious system with a frozen ocean world and a volcanic planet inhabited by underground creatures.',
   'A peaceful blue star system with ocean life, an icy moon, and a ringed gas giant.',
   'The ruins of an ancient civilization around an orange star, with three very different planets.',
];

// Pick an approximate saved theme; a saved example does not fulfill an arbitrary new prompt.
export function pickSavedSystem(systems, prompt) {
   const words = new Set(String(prompt).toLowerCase().match(/[a-z]+/g) || []);
   let best = systems[0], bestScore = -1;
   for (const entry of systems) {
      const score = entry.keywords.filter(word => words.has(word)).length;
      if (score > bestScore) { best = entry; bestScore = score; }
   }
   return best;
}

const clamp = (x, lo, hi, fallback) => Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : fallback;
const text = (value, fallback, max = 160) => typeof value === 'string' && value.trim()
   ? value.replace(/[^\x20-\x7e\n]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) || fallback : fallback;
const color = value => [0, 1, 2].map(i => clamp(value?.[i], .25, 1.4, 1));
const norm = v => Math.hypot(...v);
const unit = v => v.map(x => x / norm(v));
export const validPosition = p => Array.isArray(p) && p.length === 3 && p.every(x => Number.isFinite(x) && Math.abs(x) <= 30);

export const beamDepth = (depth, joystick, dt) => Math.max(.25, Math.min(8,
   depth - (Number.isFinite(joystick) && Math.abs(joystick) > .15 ? joystick : 0) * 1.2 * Math.max(0, Math.min(dt, .05))));
export const beamPosition = (origin, direction, depth) => origin.map((x, i) => x + direction[i] * depth);
export function rayHit(origin, direction, center, radius) {
   const v = center.map((x, i) => x - origin[i]);
   const along = v.reduce((sum, x, i) => sum + x * direction[i], 0);
   const d = radius * radius - v.reduce((sum, x) => sum + x * x, 0) + along * along;
   if (d < 0 || along + Math.sqrt(d) < 0) return null;
   return Math.max(0, along - Math.sqrt(d));
}

export function readSnapshot(value) {
   if (!value || value.version !== 1 || !Number.isInteger(value.epoch) || value.epoch < 0 ||
       !Number.isFinite(value.clock?.elapsed) || !Number.isFinite(value.clock?.at) ||
       typeof value.clock.paused !== 'boolean' || !Array.isArray(value.planets) || value.planets.length !== 3 ||
       value.planets.some(p => !p || !validPosition(p.position) || !Number.isFinite(p.lastHeard) ||
          !(p.owner === null || Number.isInteger(p.owner)) || !(p.hand === null || ['left', 'right'].includes(p.hand)) ||
          !Number.isFinite(p.orbit?.radius) || p.orbit.radius < 0 || p.orbit.radius > 60 ||
          !validPosition(p.orbit.u) || !validPosition(p.orbit.v) ||
          !Number.isFinite(p.orbit.phase) || !Number.isFinite(p.orbit.startedAt)) ||
       (value.generation !== null && (!Number.isInteger(value.generation?.owner) ||
          typeof value.generation.token !== 'string' || typeof value.generation.prompt !== 'string' || !Number.isFinite(value.generation.at))))
      throw new Error('Invalid shared solar system snapshot.');
   return { ...JSON.parse(JSON.stringify(value)), system: normalizeSystem(value.system), notice: text(value.notice, '') };
}

export function normalizeSystem(data) {
   if (!data || !Array.isArray(data.planets) || data.planets.length !== 3 || !data.star ||
       data.planets.some(p => !p || !TYPES.includes(p.type)))
      throw new Error('The AI must return one star and exactly three planets with supported surface types.');
   return {
      name: text(data.name, 'Uncharted System', 40),
      description: text(data.description, 'Three worlds waiting to be explored.'),
      star: {
         name: text(data.star.name, 'Solara', 28), color: color(data.star.color),
         radius: clamp(data.star.radius, .13, .23, .18),
         description: text(data.star.description, 'A distant star illuminates these fictional worlds.'),
      },
      planets: data.planets.map((p, i) => ({
         name: text(p.name, 'World ' + (i + 1), 28), type: p.type, color: color(p.color),
         texture: typeof p.texture === 'string' && PLANET_TEXTURES[p.texture]?.type === p.type ? p.texture : p.type,
         radius: clamp(p.radius, .06, .14, .09),
         orbitRadius: clamp(p.orbitRadius, .4 + i * .32, .55 + i * .32, .46 + i * .32),
         speed: clamp(p.speed, .08, .55, .26 - i * .06),
         tilt: clamp(p.tilt, -.55, .55, i * .15),
         spin: clamp(p.spin, -.6, .6, .18), rings: p.rings === true, moon: p.moon === true,
         surface: text(p.surface, typeof p.texture === 'string' && PLANET_TEXTURES[p.texture]?.type === p.type
            ? PLANET_TEXTURES[p.texture].description : PLANET_TEXTURES[p.type].description, 110),
         atmosphere: text(p.atmosphere, 'Unknown.', 90),
         life: text(p.life, 'No life detected.', 110),
         discovery: text(p.discovery, 'Its mysteries remain undiscovered.', 130),
      })),
   };
}

export const DEMO = normalizeSystem({
   name: 'The Lumen Reach', description: 'An ocean, a frozen frontier, and a giant guarding the remains of an ancient civilization.',
   star: { name: 'Lumen', color: [1.25, 1.05, .8], description: 'A warm amber star at the heart of the Lumen Reach.' },
   planets: [
      { name: 'Pelagia', type: 'ocean', texture: 'emerald-archipelago', color: [.9, 1, 1.05], radius: .09, moon: true,
        surface: 'Deep blue seas surround emerald island chains.', atmosphere: 'Dense oxygen-rich air and high silver clouds.',
        life: 'Bioluminescent reef colonies exchange patterns of light.', discovery: 'A geometric signal repeats beneath the deepest ocean.' },
      { name: 'Nivalis', type: 'ice', texture: 'glacial-rifts', color: [.9, 1, 1.05], radius: .08,
        surface: 'Fractured ice covers a hidden global ocean.', atmosphere: 'A thin, pale veil of nitrogen.',
        life: 'Heat-loving microbes may gather around buried vents.', discovery: 'Ancient towers cast shadows beneath the ice.' },
      { name: 'Aureon', type: 'gas', color: [1.1, .9, .75], radius: .135, rings: true,
        surface: 'Amber cloud belts swirl around a centuries-old storm.', atmosphere: 'Deep hydrogen clouds with suspended mineral dust.',
        life: 'Fictional buoyant organisms drift through temperate cloud layers.', discovery: 'Its rings contain fragments of an abandoned orbital city.' },
   ],
});

export const simulationTime = (state, at) => state.clock.elapsed + (state.clock.paused ? 0 : Math.max(0, at - state.clock.at));
const initialPlanets = (system, time = 0) => system.planets.map((p, i) => ({
   owner: null, hand: null, lastHeard: 0, position: CENTER.slice(),
   orbit: { radius: p.orbitRadius, u: [1, 0, 0], v: [0, Math.sin(p.tilt), Math.cos(p.tilt)],
            phase: i * 2.1 + .5, startedAt: time },
}));
export function createState(at = 0) {
   return { version: 1, epoch: 0, system: JSON.parse(JSON.stringify(DEMO)),
      clock: { elapsed: 0, at, paused: false }, planets: initialPlanets(DEMO), generation: null, error: '', notice: '' };
}
export function planetPosition(state, id, at) {
   const p = state.planets[id];
   if (p.owner !== null) return p.position.slice();
   const o = p.orbit, angle = o.phase + state.system.planets[id].speed * (simulationTime(state, at) - o.startedAt);
   return CENTER.map((c, i) => c + o.radius * (Math.cos(angle) * o.u[i] + Math.sin(angle) * o.v[i]));
}
function release(state, id, position, at) {
   const p = state.planets[id];
   const relative = position.map((x, i) => x - CENTER[i]);
   const u = norm(relative) > .001 ? unit(relative) : [1, 0, 0];
   let v = [-u[2], 0, u[0]];
   v = norm(v) > .001 ? unit(v) : [1, 0, 0];
   p.orbit = { radius: Math.max(state.system.star.radius + state.system.planets[id].radius + .04, norm(relative)),
      u, v, phase: 0, startedAt: simulationTime(state, at) };
   p.owner = p.hand = null;
   p.position = position.slice();
}

// All replicas apply relay-stamped actions in the same order, including local actions.
export function applyAction(state, msg, sender) {
   if (!msg || !Number.isFinite(msg.at)) return;
   if (msg.op === 'leave') {
      state.planets.forEach((p, i) => { if (p.owner === sender) release(state, i, p.position, msg.at); });
      if (state.generation?.owner === sender) { state.generation = null; state.error = 'Generating player left. Try again.'; }
      return;
   }
   if (msg.epoch !== state.epoch) return;
   if (msg.op === 'expire') {
      state.planets.forEach((p, i) => { if (p.owner !== null && msg.at - p.lastHeard > 3) release(state, i, p.position, msg.at); });
      if (state.generation && msg.at - state.generation.at > 90) {
         state.generation = null; state.error = 'Generation timed out. Your existing system is still here.';
      }
      return;
   }
   if (msg.op === 'generate') {
      if (!state.generation && typeof msg.token === 'string' && typeof msg.prompt === 'string' && msg.prompt.trim()) {
         state.generation = { owner: sender, token: msg.token.slice(0, 80), prompt: msg.prompt.slice(0, 600), at: msg.at };
         state.error = '';
      }
      return;
   }
   if (msg.op === 'generated' || msg.op === 'generationError') {
      if (!state.generation || state.generation.owner !== sender || state.generation.token !== msg.token) return;
      if (msg.op === 'generated') {
         try {
            const system = normalizeSystem(msg.system);
            state.system = system; state.epoch++;
            state.clock = { elapsed: 0, at: msg.at, paused: false };
            state.planets = initialPlanets(system); state.error = '';
            state.notice = text(msg.notice, '');
         } catch (e) { state.error = e.message; }
      } else state.error = text(msg.error, 'Generation failed. Try again.');
      state.generation = null;
      return;
   }
   if (msg.op === 'reset') {
      state.clock = { elapsed: 0, at: msg.at, paused: false };
      state.planets = initialPlanets(state.system); state.generation = null; state.error = ''; state.epoch++;
      return;
   }
   if (msg.op === 'pause') {
      state.clock = { elapsed: simulationTime(state, msg.at), at: msg.at, paused: !state.clock.paused };
      return;
   }
   if (!Number.isInteger(msg.id) || !state.planets[msg.id] || !['left', 'right'].includes(msg.hand)) return;
   const p = state.planets[msg.id];
   if (msg.op === 'grab') {
      if (p.owner !== null || state.planets.some(q => q.owner === sender && q.hand === msg.hand)) return;
      p.position = planetPosition(state, msg.id, msg.at); p.owner = sender; p.hand = msg.hand; p.lastHeard = msg.at;
   } else if (p.owner === sender && p.hand === msg.hand && validPosition(msg.position)) {
      if (msg.op === 'move') { p.position = msg.position.slice(); p.lastHeard = msg.at; }
      if (msg.op === 'release') release(state, msg.id, msg.position, msg.at);
   }
}

export const AI_PROMPT = `Create a fictional alien solar system matching the user's idea. Return JSON only, one star and exactly 3 planets.
Use this schema: {"name":"system name","description":"one sentence","star":{"name":"name","color":[1,1,1],"radius":0.18,"description":"one sentence"},"planets":[{"name":"name","type":"ocean","texture":"turquoise-reefs","color":[1,1,1],"radius":0.09,"orbitRadius":0.46,"speed":0.25,"tilt":0.1,"spin":0.18,"rings":false,"moon":true,"surface":"one short sentence","atmosphere":"one short sentence","life":"one short sentence","discovery":"one short sentence"}]}.
Allowed types: rocky, ocean, ice, volcanic, gas. Choose types that match their surface and life descriptions.
Choose a texture ID whose type matches the planet, and write surface/life details consistent with its appearance. Prefer the new alien textures when appropriate. Available textures:
${Object.entries(PLANET_TEXTURES).map(([id, t]) => id + ' (' + t.type + '): ' + t.description).join('\n')}
Colors tint bundled textures; prefer channels between 0.65 and 1.25. Radii 0.06 to 0.14, orbit radii about 0.46, 0.78, 1.10, speeds 0.08 to 0.55 radians/second, tilt -0.55 to 0.55. At most one ringed planet and one moon. Star radius 0.13 to 0.23. Use short ASCII text, names under 28 characters, each description under 110 characters. This is a miniature fictional exhibit, not a physical simulation.
User idea: `;
