import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera, Vector3} from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {setupViewportNavigation} from './src/viewport-navigation.js';

// Exercise the real OrbitControls event handlers without a WebGL renderer.
class Surface {
  listeners=new Map();style={};clientWidth=1000;clientHeight=800;
  constructor(document){this.ownerDocument=document||new Surface(this);}
  getRootNode(){return this.ownerDocument;}
  getBoundingClientRect(){return {left:0,top:0,width:this.clientWidth,height:this.clientHeight};}
  setPointerCapture(){} releasePointerCapture(){}
  addEventListener(type,fn,options){const list=this.listeners.get(type)||[];list.push({fn,capture:options===true||!!options?.capture});this.listeners.set(type,list);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(item=>item.fn!==fn));}
  emit(type,values={}){
    const event={type,clientX:500,clientY:400,pointerType:'mouse',pointerId:1,button:0,deltaMode:0,deltaY:0,preventDefault(){},...values};
    for(const {fn} of [...(this.listeners.get(type)||[])].sort((a,b)=>Number(b.capture)-Number(a.capture)))fn(event);
  }
}
function fixture({radius=500,rotated=false}={}){
  const element=new Surface(),camera=new PerspectiveCamera(50,1.25,.1,1e7);
  camera.position.set(0,0,radius);const controls=new OrbitControls(camera,element);controls.minDistance=.1;
  if(rotated){camera.position.set(radius*.8,radius*.36,radius*.48);controls.update();}
  camera.updateMatrixWorld();
  const direction=camera.getWorldDirection(new Vector3());
  // Place the observed node beyond the old orbit target, as in a deep 3D slice.
  const point=camera.position.clone().addScaledVector(direction,radius+1000);
  let nodes=[{id:'observed',x:point.x,y:point.y,z:point.z}];let interruptions=0;
  const navigation=setupViewportNavigation({camera,controls,element,getNodes:()=>nodes,interruptTransition:()=>{interruptions++;}});
  return {element,camera,controls,point,navigation,get interruptions(){return interruptions;},setNodes:value=>{nodes=value;}};
}
function screen(camera,point,element){camera.updateMatrixWorld();const p=point.clone().project(camera);return {x:(p.x+1)*element.clientWidth/2,y:(1-p.y)*element.clientHeight/2};}
function depth(camera,point){return point.clone().sub(camera.position).dot(camera.getWorldDirection(new Vector3()));}
const close=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<1e-6,`${message}: ${actual} != ${expected}`);

test('repeated wheel steps retain the same visible magnification even after the old target is reached',()=>{
  for(const radius of [500,10,.1]){
    const f=fixture({radius});
    for(let i=0;i<60;i++){
      const before=depth(f.camera,f.point);
      f.element.emit('wheel',{deltaY:-100});
      close(before/depth(f.camera,f.point),1/.95,`radius ${radius}, step ${i}`);
    }
    f.navigation.dispose();f.controls.dispose();
  }
});

test('left drag follows screen pixels at far and close zoom, including an oblique slice',()=>{
  for(const radius of [500,.1])for(const rotated of [false,true]){
    const f=fixture({radius,rotated}),before=screen(f.camera,f.point,f.element);
    const position=f.camera.position.clone(),orientation=f.camera.quaternion.clone();
    f.element.emit('pointerdown',{button:0,clientX:before.x,clientY:before.y});
    assert.ok(position.distanceTo(f.camera.position)<1e-8,'rebasing must not move the camera');
    assert.ok(orientation.angleTo(f.camera.quaternion)<1e-7,'rebasing must not turn toward an off-center node');
    f.element.ownerDocument.emit('pointermove',{button:0,clientX:before.x+100,clientY:before.y+60});
    const after=screen(f.camera,f.point,f.element);
    close(after.x-before.x,100,'horizontal pan');close(after.y-before.y,60,'vertical pan');
    f.element.ownerDocument.emit('pointerup',{button:0});
    f.navigation.dispose();f.controls.dispose();
  }
});

test('right drag rotates around the target while planar views keep rotation disabled',()=>{
  for(const enableRotate of [true,false]){
    const f=fixture(),target=f.controls.target.clone(),orientation=f.camera.quaternion.clone();
    const radius=f.camera.position.distanceTo(target);
    f.controls.enableRotate=enableRotate;
    f.element.emit('pointerdown',{button:2});
    f.element.ownerDocument.emit('pointermove',{button:2,clientX:600,clientY:460});
    assert.deepEqual(f.controls.target,target,'rotation must not pan the target');
    close(f.camera.position.distanceTo(target),radius,'rotation keeps orbit radius');
    if(enableRotate)assert.ok(orientation.angleTo(f.camera.quaternion)>.1,'right drag rotates');
    else close(orientation.angleTo(f.camera.quaternion),0,'planar views stay planar');
    f.element.ownerDocument.emit('pointerup',{button:2});
    f.navigation.dispose();f.controls.dispose();
  }
});

test('zoom is anchored under an off-center cursor with a constant ratio',()=>{
  const f=fixture({radius:.1});f.point.x=320;f.point.y=140;
  f.setNodes([{id:'observed',...f.point}]);
  const cursor=screen(f.camera,f.point,f.element);
  for(let i=0;i<20;i++){
    const before=depth(f.camera,f.point);f.element.emit('wheel',{deltaY:-100,clientX:cursor.x,clientY:cursor.y});
    const after=screen(f.camera,f.point,f.element);
    close(after.x,cursor.x,'cursor x');close(after.y,cursor.y,'cursor y');close(before/depth(f.camera,f.point),1/.95,'zoom ratio');
  }
});

test('wheel pixel, line and page units continue to use native normalization',()=>{
  for(const [deltaMode,deltaY] of [[0,-100],[1,-6.25],[2,-1]]){
    const f=fixture({radius:.1}),before=depth(f.camera,f.point);f.element.emit('wheel',{deltaMode,deltaY});
    close(before/depth(f.camera,f.point),1/.95,`delta mode ${deltaMode}`);
  }
});

test('ignored wheel input and rotation modifiers do not rebase the camera',()=>{
  const f=fixture(),target=f.controls.target.clone();
  f.controls.enableZoom=false;f.element.emit('wheel',{deltaY:-100});assert.deepEqual(f.controls.target,target);assert.equal(f.interruptions,0);
  f.controls.enableZoom=true;f.element.emit('pointerdown',{button:0,ctrlKey:true});
  assert.deepEqual(f.controls.target,target);
  const duringDrag=f.controls.target.clone(),calls=f.interruptions;f.element.emit('wheel',{deltaY:-100});
  assert.deepEqual(f.controls.target,duringDrag);assert.equal(f.interruptions,calls);
  f.element.ownerDocument.emit('pointerup',{button:0});
});

test('behind-camera and off-screen nodes do not hijack navigation depth',()=>{
  const f=fixture({radius:.1});f.setNodes([{id:'behind',x:0,y:0,z:100},{id:'offscreen',x:1e6,y:0,z:-5},{id:'observed',...f.point}]);
  const before=depth(f.camera,f.point);f.element.emit('wheel',{deltaY:-100});close(before/depth(f.camera,f.point),1/.95,'visible node depth');
  f.setNodes([]);f.navigation.reset();f.element.emit('wheel',{deltaY:100});
  assert.ok([...f.camera.position,...f.controls.target].every(Number.isFinite));
});

test('a partially visible node retains its depth instead of jumping to a background slice',()=>{
  for(const kind of ['method','paper']){
    const f=fixture({radius:1000});f.point.set(590,0,0);
    f.setNodes([{id:'foreground',kind,...f.point},{id:'background',x:0,y:0,z:-10000}]);
    const before=depth(f.camera,f.point);
    f.element.emit('wheel',{deltaY:-100,clientX:990,clientY:400});
    close(before/depth(f.camera,f.point),1/.95,`${kind} clipped at edge`);
    const start=screen(f.camera,f.point,f.element);
    f.element.emit('pointerdown',{button:0,clientX:990,clientY:400});
    f.element.ownerDocument.emit('pointermove',{button:0,clientX:940,clientY:400});
    const end=screen(f.camera,f.point,f.element);close(end.x-start.x,-50,'pan follows visible foreground');
  }
});

test('pointer gestures and explicit camera resets end the previous wheel anchor',()=>{
  for(const reset of ['pointer','explicit']){
    const f=fixture();f.element.emit('wheel',{deltaY:-100});
    const next=new Vector3(0,0,-2000);
    f.setNodes([{id:'observed',x:350,y:0,z:-1000},{id:'new-focus',...next}]);
    if(reset==='pointer'){
      f.element.emit('pointerdown',{button:2});
      f.element.ownerDocument.emit('pointerup',{button:2});
    }else f.navigation.reset();
    const before=depth(f.camera,next);f.element.emit('wheel',{deltaY:-100});
    close(before/depth(f.camera,next),1/.95,`${reset} chooses the new focus`);
    f.navigation.dispose();f.controls.dispose();
  }
});
