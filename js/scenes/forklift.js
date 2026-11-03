import * as cg from '../render/core/cg.js';
import { G2 } from '../util/g2.js';
import { buttonState, controllerMatrix, joyStickState } from '../render/core/controllerInput.js';
import { lcb, rcb } from '../handle_scenes.js';
import { C, createGame, forkPosition, setTruckPose, setForkHeight, rayTruckDistance, driveTruck } from '../util/forklift.js';

export const init = async model => {
   window.forkliftCleanup?.();
   const previousMode = window.interactMode;
   window.interactMode = 1;
   model.customShader('color = pow(5. * ambient * rgba.rgb, vec3(2.));');
   let s = createGame(), mini = false, tableHeight = .76, reference = null;
   let miniatureMap = null, grab = null, lastTime = model.time, lastVR = !!window.vr;
   let panelMinimized = false, controlsReady = false, panelHand = null, pickupTarget = false;
   const keys = new Set(), liftHands = new Set(), panelHands = new Set();
   const scene = model.add().label('forkliftWorld');
   const truck = scene.add().label('forkliftTruck');
   const yellow = [1,.64,.035], dark = [.045,.065,.085], steel = [.32,.42,.5];
   const box = (parent, p, size, color) => parent.add('cube').move(p).scale(size).color(color).dull();
   const line = (parent, a, b, r, color) => parent.add('tubeZ').placeLimb(a,b,r).color(color).dull();
   const valid = m => m?.length === 16 && Array.from(m).every(Number.isFinite);
   const buttonAmount = (hand,index) => {
      const button=buttonState[hand]?.[index];
      const value=button?.value ?? Number(!!button?.pressed);
      return Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
   };
   const headPose = () => {
      const head = window.vr ? clientState.head(clientID) : null;
      if (valid(head)) return head;
      const view = window.views?.[0];
      return view ? cg.mMultiply(clay.inverseRootMatrix, cg.mInverse(view.viewMatrix)) : cg.mTranslate(0,1.65,.6);
   };
   const handPose = hand => {
      const pose = window.vr ? clientState.hand(clientID,hand) : null;
      if (valid(pose)) return pose;
      return valid(controllerMatrix[hand]) ? cg.mMultiply(clay.inverseRootMatrix, controllerMatrix[hand]) : null;
   };
   const yawOf = m => Math.atan2(m[8],m[10]);
   const tableMatrix = () => cg.mTranslate(0,tableHeight,-.65);
   const avatarMap = () => {
      const head = headPose();
      if (!reference) reference = { floor:[head[12],cg.mTransform(clay.inverseRootMatrix,[0,0,0])[1],head[14]], yaw:yawOf(head) };
      const cab=cg.mMultiply(cg.mTranslate(s.truck),cg.mRotateY(s.yaw));
      return cg.mMultiply(cab,cg.mMultiply(cg.mTranslate(0,0,.025),cg.mMultiply(cg.mScale(C.scale),
            cg.mMultiply(cg.mRotateY(-reference.yaw),cg.mTranslate(reference.floor.map(v => -v))))));
   };
   const localHand = hand => {
      const pose = handPose(hand);
      return pose ? cg.mTransform(cg.mInverse(scene.getMatrix()),pose.slice(12,15)) : null;
   };
   const worldRay = hand => {
      const beam=hand==='left'?lcb:rcb;
      if (window.handtracking || !beam || beam.isEnabled===false ||
          typeof beam.beamMatrix!=='function' || !valid(controllerMatrix[hand])) return null;
      beam.update();
      const m=beam.beamMatrix();
      if (!valid(m) || Math.hypot(...m.slice(8,11))<1e-9) return null;
      return {origin:m.slice(12,15), direction:cg.normalize(cg.scale(m.slice(8,11),-1))};
   };
   const rayPoint = (ray,depth) => cg.mTransform(cg.mInverse(scene.getGlobalMatrix()),
      cg.add(ray.origin,cg.scale(ray.direction,depth)));
   const pickup = hand => {
      const p=localHand(hand);
      if (!p) return null;
      const q=cg.mTransform(cg.mInverse(truck.getMatrix()),p);
      if (q.every((v,i)=>v>=C.grabMin[i] && v<=C.grabMax[i])) return {point:p,depth:null};
      const ray=worldRay(hand);
      if (!ray) return null;
      const inverse=cg.mInverse(truck.getGlobalMatrix());
      const origin=cg.mTransform(inverse,ray.origin);
      const direction=cg.mTransform(inverse,[...ray.direction,0]).slice(0,3);
      const depth=rayTruckDistance(origin,direction);
      return depth===null?null:{point:rayPoint(ray,depth),depth};
   };

   const wood = new G2(true,512,512), woodContext = wood.getContext();
   woodContext.fillStyle = '#a87945'; woodContext.fillRect(0,0,512,512);
   for (let i=0; i<65; i++) {
      woodContext.strokeStyle = i%3 ? '#926336' : '#c69a61';
      woodContext.lineWidth = i%5 ? 1 : 3;
      woodContext.beginPath();
      for (let x=0; x<=512; x+=16) {
         const y=i*8+Math.sin(x*.018+i)*2;
         if (x===0) woodContext.moveTo(x,y); else woodContext.lineTo(x,y);
      }
      woodContext.stroke();
   }
   model.txtrSrc(1,wood.getCanvas());
   const floor = box(scene,[0,-tableHeight-.025,0],[3,.025,3],[.055,.09,.12]);
   box(scene,[0,.9,-3],[3,2,.025],[.10,.16,.21]);
   box(scene,[-3,.9,0],[.025,2,3],[.08,.13,.17]);
   box(scene,[3,.9,0],[.025,2,3],[.08,.13,.17]);
   box(scene,[0,2.25,0],[3,.025,3],[.09,.14,.18]);
   box(scene,[0,-.025,0],[C.tableWidth/2,.025,C.tableDepth/2],[1,1,1]).txtr(1);
   const legs = [];
   for (const x of [-.67,.67]) for (const z of [-.23,.23])
      legs.push(box(scene,[x,-tableHeight/2-.025,z],[.025,tableHeight/2-.025,.025],dark));
   const floorGrid=scene.add();
   for (let i=-3;i<=3;i++) line(floorGrid,[i*.9,0,-3],[i*.9,0,3],.003,[.12,.2,.24]);

   const outline = (p,width,depth,color) => {
      const root = scene.add().move(p);
      for (const x of [-width,width]) box(root,[x,0,0],[.002,.001,depth],color);
      for (const z of [-depth,depth]) box(root,[0,0,z],[width,.001,.002],color);
      return root;
   };
   outline([-.32,.002,-.065],.067,.065,yellow);
   for (const x of [-.030,.030])
      box(scene,[-.32+x,C.pickupHeight/2,-.065],[.004,C.pickupHeight/2,.035],dark);
   box(scene,[C.dock[0],C.dock[1]/2-.006,C.dock[2]],[.078,C.dock[1]/2-.006,.072],dark);
   box(scene,[C.dock[0],C.dock[1]-.005,C.dock[2]],[.078,.005,.072],[.1,.48,.32]);
   const dockOutline = outline([C.dock[0],C.dock[1]+.001,C.dock[2]],.077,.071,[.2,1,.57]);
   for (let i=0;i<8;i++)
      box(scene,[C.dock[0]-.07+i*.02,.025,C.dock[2]+.073],[.006,.018,.001],i%2 ? yellow : dark);

   const sign = (slot,label,p,color) => {
      const g = new G2(true,512,128), ctx = g.getContext();
      ctx.fillStyle='#0a1720'; ctx.fillRect(0,0,512,128);
      ctx.strokeStyle=color; ctx.lineWidth=12; ctx.strokeRect(6,6,500,116);
      ctx.fillStyle=color; ctx.font='bold 58px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(label,256,67);
      model.txtrSrc(slot,g.getCanvas());
      scene.add('square').move(p).turnX(-Math.PI/2).scale(.10,.025,1).txtr(slot).dull();
   };
   sign(4,'PICKUP',[-.32,.003,.23],'#ffcc42');
   sign(5,'DELIVERY',[C.dock[0],.003,.23],'#70ffc1');

   box(truck,[0,.035,.015],[.056,.019,.076],yellow);
   box(truck,[0,.070,.075],[.054,.038,.026],yellow);
   box(truck,[0,.111,.088],[.035,.004,.008],dark);
   box(truck,[0,.058,.022],[.032,.004,.034],dark);
   for (const x of [-.064,.064]) for (const z of [-.052,.067]) {
      truck.add('tubeX').move(x,.027,z).scale(.012,.027,.027).color(dark).dull();
      truck.add('tubeX').move(x*1.18,.027,z).scale(.002,.012,.012).color(steel).dull();
   }
   for (const x of [-.047,.047]) {
      box(truck,[x,.115,.065],[.004,.065,.004],steel);
      box(truck,[x,.105,-.080],[.005,.100,.006],dark);
   }
   for (const x of [-.057,.057]) box(truck,[x,.183,.015],[.004,.006,.072],yellow);
   for (const z of [-.054,.084]) box(truck,[0,.183,z],[.060,.006,.004],yellow);
   box(truck,[0,.205,-.080],[.053,.006,.008],steel);
   for (const x of [-.032,0,.032]) box(truck,[x,.190,.015],[.003,.002,.063],dark);
   const forks = truck.add().label('forkliftForks');
   box(forks,[0,.019,-.088],[.052,.019,.008],steel);
   for (const x of [-.016,.016]) box(forks,[x,-.003,-C.forkReach],[.006,.003,.061],steel);
   box(truck,[.039,.068,.002],[.012,.008,.025],dark);
   box(truck,[.039,.096,.002],[.004,.025,.004],steel);
   const lever = truck.add().label('forkliftLever');
   box(lever,[0,-.009,0],[.003,.009,.003],steel);
   lever.add('sphere').scale(.009).color([1,.28,.07]).dull();
   const grabHalo=truck.add('ringY').label('forkliftGrabTarget').move(0,.004,-.04)
      .scale(.145,1,.145).color([.12,1,.5]).dull().opacity(0);

   const cargo = scene.add().label('forkliftCargo');
   box(cargo,[0,C.crateHalf,0],[C.crateHalf,C.crateHalf,C.crateHalf],[.72,.45,.20]);
   for (const x of [-.027,.027]) {
      box(cargo,[x,.035,.036],[.003,.035,.002],[.96,.71,.38]);
   }
   for (const y of [.008,.062]) box(cargo,[0,y,.037],[.035,.003,.002],[.96,.71,.38]);
   line(cargo,[-.03,.01,.038],[.03,.06,.038],.002,[.96,.71,.38]);
   const avatar = scene.add().label('forkliftAvatar');
   const head = avatar.add().label('forkliftHead');
   head.add('sphere').scale(.085,.10,.085).color([.95,.65,.40]).dull();
   box(head,[0,.012,-.075],[.074,.037,.025],[.04,.23,.31]);
   const hands = {};
   for (const hand of ['left','right']) {
      hands[hand] = avatar.add().label('forkliftHand'+hand);
      box(hands[hand],[0,0,0],[.025,.025,.065],hand==='left' ? [.15,.8,1] : [1,.45,.22]);
      hands[hand].add('ringZ').move(0,0,-.04).scale(.045).color([1,1,1]).dull();
   }

   const panelRoot = model.add().label('forkliftPanel');
   const expandedPanel=panelRoot.add();
   const compactPanel=panelRoot.add().scale(0);
   box(expandedPanel,[0,0,-.009],[.386,.299,.008],dark);
   box(compactPanel,[0,0,-.009],[.386,.084,.008],dark);
   const g = new G2(false,1024,768);
   const compactG = new G2(false,1024,256);
   const face = expandedPanel.add('square').label('forkliftInformationPanel').scale(.38,.285,1).txtr(3).dull();
   const compactFace=compactPanel.add('square').label('forkliftCompactPanel').scale(.38,.075,1).txtr(6).dull();
   model.txtrSrc(3,g.getCanvas());
   model.txtrSrc(6,compactG.getCanvas());
   // G2's font parser assumes a numeric prefix; draw panel text directly for true bold.
   for (const graphics of [g,compactG]) graphics.text = (text,x,y,align='center') => {
      const ctx=graphics.getContext(), canvas=graphics.getCanvas();
      ctx.save(); ctx.font='bold '+ctx.font; ctx.textAlign=align; ctx.textBaseline='middle';
      ctx.fillText(String(text),(x+1)*canvas.width/2,(1-y)*canvas.height/2);
      ctx.restore(); return graphics;
   };
   const placePanel = () => {
      const h=headPose(), yaw=yawOf(h);
      panelRoot.setMatrix(cg.mMultiply(cg.mTranslate(h.slice(12,15)),cg.mRotateY(yaw)))
         .move(mini?-.64:-.80,-.02,mini?-.85:-1.15).turnY(.32);
   };
   const toggleView = () => {
      grab=null; liftHands.clear(); panelHands.clear(); controlsReady=false;panelHand=null;
      if (mini) { mini=false; miniatureMap=null; scene.setMatrix(tableMatrix()); }
      else {
         setTruckPose(s,s.truck,s.yaw,true);
         miniatureMap=avatarMap(); mini=true;
         scene.setMatrix(cg.mInverse(miniatureMap));
      }
      placePanel();
   };
   const reset = () => {
      s=createGame(); mini=false; miniatureMap=null; grab=null; keys.clear();
      liftHands.clear(); panelHands.clear(); controlsReady=false;panelHand=null;
      scene.setMatrix(tableMatrix()); placePanel();
   };
   const adjustTable = delta => {
      if (mini) return;
      tableHeight=Math.max(.5,Math.min(1.2,tableHeight+delta));
      scene.setMatrix(tableMatrix());
   };
   const viewButton = g.addWidget(face,'button',-.30,-.43,'#ffcc42',['ENTER CAB'],toggleView,1.8);
   g.addWidget(face,'button',.62,-.43,'#a1e7f5',['RESET'],reset,1.4);
   const togglePanel = () => {panelMinimized=!panelMinimized;liftHands.clear();};
   g.addWidget(face,'button',.67,.83,'#a1e7f5',['MINIMIZE'],togglePanel,1);
   for (const [x,label,delta] of [[-.48,'TABLE -',-.01],[.35,'TABLE +',.01]]) {
      const widget=g.addWidget(face,'button',x,-.76,'#ffffff',[label],()=>adjustTable(delta),1.3);
      const draw=widget.draw, within=widget.isWithin;
      widget.draw=()=>{if(!mini)draw();};
      widget.isWithin=()=>!mini && within();
   }
   const status = () => grab?.kind==='truck' ? 'CARRYING — LEFT STICK TURNS. RELEASE TO PLACE.' :
      !mini && pickupTarget ? 'GREEN TARGET — HOLD TRIGGER TO PICK UP.' :
      s.delivered ? 'DELIVERED!  RESET TO PLAY AGAIN.' : s.attached ?
      'CARGO LOADED — MOVE TO THE GREEN DOCK.' : 'ALIGN WITH PICKUP, THEN RAISE THE FORKS.';
   g.render = () => {
      g.setColor('#081a25').fillRect(-1,-1,2,2);
      g.setColor('#ffcc42').fillRect(-1,.96,2,.04);
      g.textHeight(.049).text('FORKLIFT',0,.83,'center');
      g.setColor('#ffffff').textHeight(.075).text(mini?'MINIATURE CAB':'TABLETOP VIEW',0,.61);
      const lines=mini ? ['RIGHT STICK: FORWARD / REVERSE.',
         'LEFT STICK: STEER LEFT / RIGHT.', 'TRIGGER: FORKS UP.  GRIP: FORKS DOWN.',
         'AT THE GREEN DOCK, LOWER TO DELIVER.'] : ['POINT AT FORKLIFT + HOLD TRIGGER TO CARRY.',
         'LEFT STICK: TURN HELD FORKLIFT LEFT / RIGHT.', 'MOVE CONTROLLER; RELEASE TO PLACE.',
         'ENTER CAB TO DRIVE AND USE THE FORKS.'];
      lines.forEach((text,i)=>g.textHeight(.040).text(text,0,.38-i*.14));
      g.setColor(s.delivered?'#70ffc1':'#ffcc42').textHeight(.037).text(status(),0,-.23);
      g.setColor('#bce4f3').textHeight(.030).text(mini ? 'RED LEVER ALSO WORKS: TOUCH + TRIGGER TO DRAG.' :
         'MATCH THE VIRTUAL TABLE TO YOUR REAL TABLE BELOW.',0,-.60);
   };
   compactG.render=()=>{
      compactG.setColor('#081a25').fillRect(-1,-1,2,2);
      compactG.setColor('#ffcc42').textHeight(.19).text(mini?'FORKLIFT / CAB':'FORKLIFT / TABLETOP',0,.56);
   };
   compactG.addWidget(compactFace,'button',-.45,-.28,'#a1e7f5',['SHOW INFO'],togglePanel,2.8);
   const compactViewButton=compactG.addWidget(compactFace,'button',.45,-.28,'#ffcc42',['ENTER CAB'],toggleView,2.8);
   for (const graphics of [g,compactG]) {
      const normalUVZ=graphics.computeUVZ;
      graphics.computeUVZ = matrix => {
         if (window.vr) {
            if (window.handtracking) return normalUVZ(matrix);
            // Only the hand that pressed this panel can activate its buttons.
            return panelHand ? (panelHand==='left'?lcb:rcb)?.hitRect(matrix) : null;
         }
         const view=window.views?.[0]; if (!view) return null;
         const rect=clay.gl.canvas.getBoundingClientRect();
         const p=cg.mTransform(cg.mInverse(view.projectionMatrix),
            [2*(mouseX-rect.left)/rect.width-1,1-2*(mouseY-rect.top)/rect.height,-1]);
         return cg.mHitRect(cg.mMultiply(cg.mInverse(view.viewMatrix),cg.mAimZ(cg.scale(p,-1))),matrix);
      };
   }
   const panelHit = hand => {
      const activeFace=panelMinimized?compactFace:face;
      const beam=hand==='left'?lcb:rcb;
      if (!window.handtracking && beam && valid(controllerMatrix[hand])) {
         beam.update(); return !!beam.hitRect(activeFace.getGlobalMatrix());
      }
      const pose=handPose(hand);
      if (!pose) return false;
      const p=cg.mTransform(cg.mInverse(activeFace.getMatrixFromRoot()),pose.slice(12,15));
      return Math.abs(p[0])<1 && Math.abs(p[1])<1 && Math.abs(p[2])<.1;
   };
   const press = hand => {
      if (panelHit(hand)) {panelHands.add(hand);panelHand=hand;return;}
      if (grab) return;
      const p=localHand(hand), pose=handPose(hand);
      if (!p || !pose) return;
      if (mini) {
         const knob=cg.mTransform(truck.getMatrix(),[.039,.077+.04*(s.lift-C.minLift)/(C.maxLift-C.minLift),.002]);
         if (cg.distance(p,knob)<.010) grab={hand,kind:'lever',start:p[1],lift:s.lift};
         else liftHands.add(hand);
      } else {
         const hit=pickup(hand);
         if (hit) grab={hand,kind:'truck',depth:hit.depth,offset:cg.subtract(s.truck,hit.point)};
      }
   };
   const release = hand => {
      liftHands.delete(hand);panelHands.delete(hand);
      if (grab?.hand!==hand) return;
      if (grab.kind==='truck') setTruckPose(s,s.truck,s.yaw,true);
      grab=null;
   };
   const idle=()=>{};
   const handlers={onPress:press,onRelease:release,onMove:idle,onDrag:idle,onClick:idle,onDoublePress:idle};
   const previousHandlers=Object.fromEntries(Object.keys(handlers).map(name=>[name,inputEvents[name]]));
   Object.assign(inputEvents,handlers);

   const keydown = event => {
      if (event.target.matches('input,textarea,select') || event.metaKey || event.ctrlKey || event.altKey) return;
      const key=event.key.toLowerCase();
      if (!['w','a','s','d','q','e','arrowup','arrowdown','v','r'].includes(key)) return;
      event.preventDefault(); event.stopPropagation();
      keys.add(key);
      if (!event.repeat && key==='v') toggleView();
      if (!event.repeat && key==='r') reset();
   };
   const keyup = event => {
      if (keys.delete(event.key.toLowerCase())) {event.preventDefault();event.stopPropagation();}
   };
   const blur = () => {
      keys.clear(); if (grab) release(grab.hand);
      liftHands.clear();panelHands.clear();controlsReady=false;panelHand=null;
   };
   window.addEventListener('keydown',keydown,true);
   window.addEventListener('keyup',keyup,true);
   window.addEventListener('blur',blur);
   scene.setMatrix(tableMatrix()); placePanel();

   model.animate(()=>{
      const now=model.time, dt=Math.max(0,Math.min(.05,now-lastTime || 0)); lastTime=now;
      if (!!window.vr!==lastVR) {
         mini=false; miniatureMap=null; reference=null; blur();
         scene.setMatrix(tableMatrix()); placePanel(); lastVR=!!window.vr;
      }
      if (!mini) scene.setMatrix(tableMatrix());
      if (grab) {
         const ray=grab.depth!=null?worldRay(grab.hand):null;
         const p=grab.depth!=null?(ray?rayPoint(ray,grab.depth):null):localHand(grab.hand), pose=handPose(grab.hand);
         if (!p || !pose) release(grab.hand);
         else if (grab.kind==='truck') {
            const axis=joyStickState.left?.x;
            const turn=Number.isFinite(axis) && Math.abs(axis)>=.18?Math.max(-1,Math.min(1,axis)):0;
            setTruckPose(s,cg.add(p,grab.offset),s.yaw-turn*C.turnSpeed*dt);
         }
         else setForkHeight(s,grab.lift+(p[1]-grab.start)*(C.maxLift-C.minLift)/.04);
      }
      if (grab?.kind!=='lever') {
         const direction=Number(keys.has('arrowup'))-Number(keys.has('arrowdown'));
         if (direction) setForkHeight(s,s.lift+direction*C.liftSpeed*dt);
      }
      if (!mini && !grab) {
         const dx=Number(keys.has('d'))-Number(keys.has('a'));
         const dz=Number(keys.has('s'))-Number(keys.has('w'));
         const turn=Number(keys.has('q'))-Number(keys.has('e'));
         if (dx||dz||turn) setTruckPose(s,cg.add(s.truck,[dx*.22*dt,0,dz*.22*dt]),s.yaw+turn*dt,true);
      }
      if (mini) {
         if (['left','right'].every(hand=>buttonAmount(hand,0)<.1 && buttonAmount(hand,1)<.1) &&
             Math.abs(joyStickState.right?.y||0)<.18 && Math.abs(joyStickState.left?.x||0)<.18) controlsReady=true;
         if (!grab && !panelHands.size) {
            let throttle=Number(keys.has('w'))-Number(keys.has('s'));
            const stick=joyStickState.left?.x;
            const steer=Number(keys.has('d'))-Number(keys.has('a')) || (Number.isFinite(stick)?stick:0);
            if (window.vr && !window.handtracking && controlsReady) {
               const axis=joyStickState.right?.y;
               if (Number.isFinite(axis) && Math.abs(axis)>=.18) throttle-=Math.max(-1,Math.min(1,axis));
               const up=Math.max(0,...Array.from(liftHands,hand=>valid(handPose(hand))?buttonAmount(hand,0):0));
               const down=Math.max(...['left','right'].map(hand=>buttonAmount(hand,1)>0 &&
                  valid(handPose(hand)) && !panelHit(hand)?buttonAmount(hand,1):0));
               if (up!==down) setForkHeight(s,s.lift+(up-down)*C.liftSpeed*dt);
            }
            driveTruck(s,throttle,steer,dt);
         }
         // Follow the vehicle using the fixed tracking reference; head motion alone never moves the scene.
         miniatureMap=avatarMap();
         scene.setMatrix(cg.mInverse(miniatureMap));
      }
      truck.identity().move(s.truck).turnY(s.yaw);
      pickupTarget=!mini && !grab && ['left','right'].some(hand=>!panelHit(hand) && pickup(hand));
      grabHalo.opacity(!mini && (pickupTarget || grab?.kind==='truck')?1:0);
      forks.identity().move(0,s.lift,0);
      lever.identity().move(.039,.077+.04*(s.lift-C.minLift)/(C.maxLift-C.minLift),.002);
      lever.child(1).color(grab?.kind==='lever'?[.2,1,.57]:[1,.28,.07]);
      cargo.identity().move(s.cargo).turnY(s.attached?s.yaw:0);
      dockOutline.color(s.delivered?[.2,1,.57]:s.attached && Math.hypot(forkPosition(s)[0]-C.dock[0],forkPosition(s)[2]-C.dock[2])<.026 ? [1,1,1]:[.2,1,.57]);
      const mapping=mini?miniatureMap:avatarMap();
      head.setMatrix(cg.mMultiply(mapping,headPose())).opacity(mini?0:1);
      for (const hand of ['left','right']) {
         const pose=handPose(hand);
         hands[hand].setMatrix(cg.mMultiply(mapping,pose||cg.mTranslate(0,0,0))).opacity(pose?1:0);
      }
      floor.identity().move(0,-tableHeight-.025,0).scale(3,.025,3);
      floorGrid.identity().move(0,-tableHeight+.001,0);
      legs.forEach((leg,i)=>leg.identity().move(i<2?-.67:.67,-tableHeight/2-.025,i%2?.23:-.23)
         .scale(.025,tableHeight/2-.025,.025));
      for (const hand of ['left','right']) {
         const beam=hand==='left'?lcb:rcb;
         if (window.vr && beam && valid(controllerMatrix[hand])) beam.update();
      }
      viewButton.setLabel([mini?'EXIT CAB':'ENTER CAB']);
      compactViewButton.setLabel([mini?'EXIT CAB':'ENTER CAB']);
      expandedPanel.identity().scale(panelMinimized?0:1);
      compactPanel.identity().scale(panelMinimized?1:0);
      const activeGraphics=panelMinimized?compactG:g;
      activeGraphics.update();
      if (!panelHands.size && ['release','move'].includes(activeGraphics.mouseState())) panelHand=null;
      minimize.textContent=panelMinimized?'Show info':'Minimize';
      minimize.setAttribute('aria-expanded',String(!panelMinimized));
   });

   window.forkliftCleanup=()=>{
      blur();
      window.removeEventListener('keydown',keydown,true);
      window.removeEventListener('keyup',keyup,true);
      window.removeEventListener('blur',blur);
      for (const name in handlers)
         if (inputEvents[name]===handlers[name]) inputEvents[name]=previousHandlers[name];
      window.interactMode=previousMode;
   };
};

export const deinit = () => {window.forkliftCleanup?.();delete window.forkliftCleanup;};
