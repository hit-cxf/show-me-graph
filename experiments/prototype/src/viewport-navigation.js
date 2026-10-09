import {MOUSE, Vector3} from 'three';
import {nodeDimensions} from './node-dimensions.js';

// OrbitControls scales both dolly and pan by the distance to its target. A
// graph's bounding-box center is often empty space in front of the visible slice;
// approaching that old target must not make navigation grind to a halt.
export function setupViewportNavigation({camera,controls,element,getNodes,interruptTransition=()=>{}}) {
  controls.mouseButtons.LEFT=MOUSE.PAN;
  controls.mouseButtons.RIGHT=MOUSE.ROTATE;
  controls.screenSpacePanning=true;
  controls.zoomToCursor=true;
  let wheelAnchor=null,lastWheel=0,lastPointer=null;
  const forward=new Vector3(),projected=new Vector3(),ray=new Vector3();
  const position=node=>new Vector3(node.fx??node.x,node.fy??node.y,node.fz??node.z);
  const minimumDepth=()=>Math.max(camera.near*2,controls.minDistance,1e-3);

  function visiblePoint(node,rect) {
    const point=position(node);
    if(!point.toArray().every(Number.isFinite))return null;
    const depth=point.clone().sub(camera.position).dot(forward);
    if(depth<minimumDepth()||depth>camera.far)return null;
    projected.copy(point).project(camera);
    if(projected.z< -1||projected.z>1)return null;
    const x=rect.left+(projected.x+1)*rect.width/2,y=rect.top+(1-projected.y)*rect.height/2;
    const pixelsPerUnit=camera.projectionMatrix.elements[5]*rect.height/(2*depth);
    const {pixelWidth,pixelHeight}=nodeDimensions(node,pixelsPerUnit);
    const rx=pixelWidth/2,ry=pixelHeight/2;
    // A large, still-visible circle/label can have its center outside the frame.
    // Dropping it would abruptly transfer zoom to a distant background slice.
    if(x+rx<rect.left||x-rx>rect.left+rect.width||y+ry<rect.top||y-ry>rect.top+rect.height)return null;
    return {id:node.id,point,depth,x,y,rx,ry,paper:node.kind==='paper'};
  }

  function prepare(event,wheel) {
    interruptTransition();
    camera.updateMatrixWorld();camera.getWorldDirection(forward);
    const rect=element.getBoundingClientRect();
    if(!(rect.width>0&&rect.height>0))return;
    const nodes=getNodes(),now=performance.now();
    // Hold the chosen depth source during a wheel gesture, preventing adjacent
    // slices from repeatedly taking over as their projected positions change.
    let anchor=null;
    if(wheel&&wheelAnchor&&now-lastWheel<300&&lastPointer&&Math.hypot(event.clientX-lastPointer.x,event.clientY-lastPointer.y)<32){
      const node=nodes.find(node=>node.id===wheelAnchor);
      if(node)anchor=visiblePoint(node,rect);
    }
    if(!anchor){
      let nearest=Infinity;
      for(const node of nodes){
        const candidate=visiblePoint(node,rect);if(!candidate)continue;
        const dx=Math.abs(candidate.x-event.clientX),dy=Math.abs(candidate.y-event.clientY);
        const distance=candidate.paper?Math.hypot(Math.max(0,dx-candidate.rx),Math.max(0,dy-candidate.ry)):
          Math.max(0,Math.hypot(dx,dy)-candidate.rx);
        if(distance<nearest||distance===nearest&&candidate.depth<anchor.depth){nearest=distance;anchor=candidate;}
      }
    }
    if(wheel){wheelAnchor=anchor?.id||null;lastWheel=now;lastPointer={x:event.clientX,y:event.clientY};}
    else wheelAnchor=null;
    if(!anchor)return; // Blank views keep their existing, valid navigation plane.

    let distance=anchor.depth;
    if(wheel){
      ray.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2,1)
        .unproject(camera).sub(camera.position).normalize();
      // Native cursor zoom moves along this ray. Compensate for its angle so
      // one wheel increment changes visible depth by the same ratio everywhere.
      distance/=Math.max(.01,ray.dot(forward));
    }
    distance=Math.min(controls.maxDistance,Math.max(controls.minDistance,distance));
    if(!Number.isFinite(distance)||distance<=0)return;
    // Change only the depth, never the camera position or viewing direction.
    // Pan then stays ~1 screen pixel per mouse pixel at the observed depth.
    controls.target.copy(camera.position).addScaledVector(forward,distance);
    controls.update();
  }
  function wheel(event){
    if(!controls.enabled||!controls.enableZoom||controls.state!==-1||!event.deltaY)return;
    prepare(event,true);
  }
  function pointerDown(event){
    reset();
    if(!controls.enabled||controls.state!==-1)return;
    const key=['LEFT','MIDDLE','RIGHT'][event.button],action=controls.mouseButtons[key];
    const modified=event.ctrlKey||event.metaKey||event.shiftKey;
    const panning=(action===MOUSE.PAN&&!modified)||(action===MOUSE.ROTATE&&modified);
    if((panning&&controls.enablePan)||(action===MOUSE.DOLLY&&controls.enableZoom))prepare(event,false);
    else interruptTransition();
  }
  function reset(){wheelAnchor=null;lastPointer=null;lastWheel=0;}
  // Capture runs before the installed OrbitControls handlers. Retain their
  // wheel-unit normalization, pointer capture, keyboard modifiers and events.
  element.addEventListener('wheel',wheel,{capture:true,passive:true});
  element.addEventListener('pointerdown',pointerDown,{capture:true});
  return {
    reset,
    dispose(){element.removeEventListener('wheel',wheel,true);element.removeEventListener('pointerdown',pointerDown,true);},
  };
}
