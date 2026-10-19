import * as cg from '../render/core/cg.js';
import { createRobot } from './SO101.js';
import { controls, text, hitBox, dragPoint } from '../util/hw5-ui.js';

const TABLE_Y = 1.02;
const NAMES = ['Shoulder pan','Shoulder lift','Elbow flex','Wrist flex','Wrist roll','Gripper'];
const degrees = radians => radians * 180 / Math.PI;
let ui;

export const init = async model => {
   ui?.remove();
   const robot = createRobot(model, [-.18,TABLE_Y,-.85]);
   const joints = robot.joints.filter(j => !j.fixed);
   let angles = [0,0,0,0,0,0], selected = 0, playing = false, demoTime = 0, lastTime;
   const target = [.16,TABLE_Y+.045,-.73];
   const held = {};
   model.add('cube').move(0,TABLE_Y-.025,-.85).scale(.48,.025,.35).color(.12,.19,.25);
   text(model, 'hw5RobotHeading', 'SO101 / OPERATOR VIEW', [-.65,1.92,-.95], .85, [.5,.85,1]);
   text(model, 'hw5RobotInstructions', 'Task: align the gripper with the cyan target.\nPoint at a joint slider, hold trigger and drag LEFT / RIGHT.\nTouch and pinch also works. Grab cyan target to move it.\nSimulated angles relative to the supplied zero pose.', [-.65,1.82,-.95], .42);
   const targetNode = model.add('sphere').scale(.018).color(0,.85,1);
   const targetRing = model.add('ringY').move(target[0],TABLE_Y+.005,target[2]).scale(.032).color(0,.85,1);
   const toolMarker = model.add('sphere').scale(.008).color(1,.8,.25);
   const distanceLine = model.add('tubeZ').color(0,.85,1);
   const heightLine = model.add('tubeZ').color(.55,.8,1);
   const distanceLabel = text(model, 'hw5RobotDistance', 'Target distance', [-.43,.79,-.45], .42, [0,.9,1]);
   const toolLabel = text(model, 'hw5RobotTool', 'Tool position', [-.43,.91,-.45], .44, [.7,.87,1]);

   const labels = joints.map((j,i) => {
      const position = [.34,1.66-i*.11,-.86];
      const label = text(model, 'hw5RobotJoint'+i, NAMES[i], position, .5);
      const leader = model.add('tubeZ').color(.4,.5,.6);
      const marker = model.add('sphere').scale(.007).color(.3,.8,.55);
      const track = model.add('cube').move(position[0]+.2,position[1]-.065,position[2]).scale(.2,.014,.008).color(.2,.3,.4).dull();
      const pointer = model.add('sphere').scale(.012).color(1,.85,.3);
      return { label, leader, marker, track, pointer, position };
   });
   ui = controls(model, 'hw5-robot-controls', 'Robot operator controls', [-1.06,1.62,-.88]);
   const ownUI = ui;
   const selectLabel = ui.button('Joint: '+NAMES[selected], () => {
      selected = (selected+1)%joints.length;
      selectLabel('Joint: '+NAMES[selected]);
   });
   const adjust = delta => {
      playing = false;
      playLabel('Play joint demo');
      angles[selected] = cg.clamp(angles[selected]+delta*Math.PI/180,joints[selected].lo,joints[selected].hi);
   };
   ui.button('-5 degrees', () => adjust(-5));
   ui.button('+5 degrees', () => adjust(5));
   const playLabel = ui.button('Play joint demo', () => {
      playing = !playing;
      playLabel(playing ? 'Pause joint demo' : 'Play joint demo');
      // Begin smoothly from the current configuration.
      if (playing) { startPose = angles.slice(); demoTime = 0; }
   });
   ui.button('Reset pose', () => {
      playing = false; angles.fill(0); demoTime = 0;
      playLabel('Play joint demo');
   });
   let startPose = angles.slice();
   const sliders = joints.map((j,i) => {
      const label = document.createElement('label');
      label.style.cssText = 'display:block;margin-top:8px';
      const caption = document.createElement('span');
      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = degrees(j.lo); slider.max = degrees(j.hi); slider.step = 'any'; slider.value = 0;
      slider.style.width = '100%'; slider.setAttribute('aria-label', NAMES[i]+' angle');
      slider.oninput = () => {
         selected = i; playing = false; angles[i] = Number(slider.value)*Math.PI/180;
         selectLabel('Joint: '+NAMES[i]); playLabel('Play joint demo');
      };
      label.append(caption,slider); ui.desktop.append(label);
      return { caption, slider };
   });
   const positionOf = node => cg.mTransform(cg.mInverse(model.getGlobalMatrix()), node.getGlobalMatrix().slice(12,15));
   let nextReadout = 0;
   const update = () => {
      const dt = lastTime === undefined ? 0 : Math.max(0,Math.min(.1,model.time-lastTime));
      lastTime = model.time;
      if (playing) {
         demoTime += dt;
         const blend = cg.ease(Math.min(1,demoTime/2));
         angles = joints.map((j,i) => {
            const middle = (j.lo+j.hi)/2, amplitude = (j.hi-j.lo)*.46;
            const demo = middle + amplitude*Math.sin(demoTime*.4+i*.7);
            return cg.mixf(startPose[i],demo,blend);
         });
      }
      angles = robot.update(angles);
      const tool = positionOf(robot.node.gripper_frame);
      const distance = cg.distance(tool,target), height = tool[1]-TABLE_Y;
      targetNode.identity().move(target).scale(.018);
      targetRing.identity().move(target[0],TABLE_Y+.005,target[2]).scale(.032);
      toolMarker.identity().move(tool).scale(.008);
      // placeLimb handles endpoints symmetrically; hide zero-length lines to avoid undefined aim vectors.
      if (distance > .0001) distanceLine.placeLimb(tool,target,.0015); else distanceLine.identity().scale(0);
      if (Math.abs(height) > .0001) heightLine.placeLimb(tool,[tool[0],TABLE_Y,tool[2]],.001);
      else heightLine.identity().scale(0);
      const readoutDue = model.time >= nextReadout;
      if (readoutDue) nextReadout = model.time+.2;
      joints.forEach((j,i) => {
         const p = positionOf(robot.node[j.name]);
         const margin = Math.min(angles[i]-j.lo,j.hi-angles[i]);
         const nearLimit = margin < 10*Math.PI/180;
         const color = nearLimit ? [1,.35,.2] : i === selected ? [1,.85,.3] : [.45,.9,.65];
         const entry = labels[i];
         entry.marker.identity().move(p).scale(i === selected ? .01 : .007).color(color);
         entry.leader.placeLimb(p,entry.position,.0008).color(color);
         const fraction = (angles[i]-j.lo)/(j.hi-j.lo);
         entry.pointer.identity().move(entry.position[0]+fraction*.4,entry.position[1]-.065,entry.position[2]+.012).scale(.014).color(color);
         entry.label.node.color(color);
         if (readoutDue) {
            entry.label.set(NAMES[i]+' '+degrees(angles[i]).toFixed(1)+' deg\n'+degrees(j.lo).toFixed(0)+'..'+degrees(j.hi).toFixed(0)+' / margin '+degrees(margin).toFixed(0)+' deg');
            sliders[i].caption.textContent = NAMES[i]+': '+degrees(angles[i]).toFixed(1)+' deg';
            sliders[i].slider.value = degrees(angles[i]);
         }
      });
      if (readoutDue) {
         distanceLabel.set((distance*100).toFixed(1)+' cm to target');
         toolLabel.set('Tool offset from base (cm):\nX '+((tool[0]+.18)*100).toFixed(1)+' / Y '+(height*100).toFixed(1)+' / Z '+((tool[2]+.85)*100).toFixed(1)+
            '\nTool point above table: '+(height*100).toFixed(1)+' cm');
         toolLabel.node.color(height < 0 ? [1,.35,.2] : [.7,.87,1]);
         ownUI.status((playing ? 'Joint demonstration. ' : 'Manual positioning. ')+
            'Gold = selected; red = within 10 deg of a joint limit.\n'+
            (distance < .02 ? 'Tool point within 2 cm of target. ' : 'Move tool toward cyan target. ')+
            'Joint limits alone do not check collisions.');
      }
   };
   const setSlider = (hand,grab) => {
      const p = dragPoint(hand,grab,labels[grab.index].track);
      if (!p) return;
      const x = cg.mTransform(cg.mInverse(labels[grab.index].track.getMatrixFromRoot()),p)[0];
      const j = joints[grab.index];
      angles[grab.index] = cg.mixf(j.lo,j.hi,cg.clamp((x+1)/2));
      selected = grab.index; playing = false;
      selectLabel('Joint: '+NAMES[selected]); playLabel('Play joint demo');
   };
   inputEvents.onPress = hand => {
      if (ownUI.press(hand)) return;
      const hits = labels.map((entry,index) => {
         const hit = hitBox(hand,entry.track);
         return hit && {...hit,type:'slider',index};
      }).filter(Boolean);
      const targetHit = hitBox(hand,targetNode);
      if (targetHit) hits.push({...targetHit,type:'target',offset:cg.subtract(target,targetHit.point)});
      hits.sort((a,b) => a.distance-b.distance);
      if (hits.length) {
         held[hand] = hits[0];
         if (hits[0].type === 'slider') setSlider(hand,hits[0]);
      }
   };
   inputEvents.onDrag = hand => {
      const grab = held[hand];
      if (!grab) return;
      if (grab.type === 'slider') { setSlider(hand,grab); return; }
      const point = dragPoint(hand,grab);
      if (!point) return;
      const p = cg.add(point,grab.offset);
      target[0] = cg.clamp(p[0],-.4,.4);
      target[1] = cg.clamp(p[1],TABLE_Y+.02,1.55);
      target[2] = cg.clamp(p[2],-1.15,-.55);
   };
   inputEvents.onRelease = hand => { delete held[hand]; };
   inputEvents.onClick = () => {};
   window.hw5Robot = { get angles() { return angles.slice(); }, get target() { return target.slice(); } };
   update();
   model.animate(update);
};

export const deinit = () => {
   ui?.remove();
   delete window.hw5Robot;
   inputEvents.onPress = inputEvents.onDrag = inputEvents.onRelease = inputEvents.onClick = () => {};
};
