import * as THREE from 'three';
import {nodeDimensions} from './node-dimensions.js';

function wrapText(context, value, maxWidth) {
  const tokens=String(value||'未命名节点').match(/[A-Za-z0-9][A-Za-z0-9+._/-]*|[\u3400-\u9fff]|\s+|[^\u3400-\u9fffA-Za-z0-9\s]/gu)||[];
  const lines=[];let current='';
  for(const token of tokens){
    if(token.includes('\n')){if(current.trim())lines.push(current.trim());current='';continue;}
    if(!current&&!token.trim())continue;
    if(current&&context.measureText(current+token).width>maxWidth){lines.push(current.trimEnd());current=token.trimStart();}else current+=token;
    if(context.measureText(current).width>maxWidth){const chars=Array.from(current);current='';for(const character of chars){if(current&&context.measureText(current+character).width>maxWidth){lines.push(current);current='';}current+=character;}}
  }
  if(current||!lines.length)lines.push(current.trim());return lines;
}

function nodeTexture(node,palette,ink){
  const paper=node.kind==='paper',width=paper?720:512,height=paper?264:512;
  const canvas=document.createElement('canvas');canvas.width=width*2;canvas.height=height*2;
  const context=canvas.getContext('2d');context.scale(2,2);
  const dark=new THREE.Color(palette.bg).getHSL({}).l<.3;
  const fill=new THREE.Color(palette.bg).lerp(new THREE.Color(ink),dark?.15:.07).getStyle();
  context.fillStyle=fill;context.strokeStyle=ink;context.lineWidth=paper?4:5;
  context.beginPath();
  if(paper)context.roundRect(8,8,width-16,height-16,22);else context.arc(width/2,height/2,width/2-12,0,Math.PI*2);
  context.fill();context.stroke();
  if(paper){context.fillStyle=ink;context.globalAlpha=.14;context.fillRect(10,10,12,height-20);context.globalAlpha=1;}
  // Each occurrence keeps its name, including entities shared by several papers.
  {
    let font=paper?62:68,lines;
    const areaWidth=paper?width-92:width*.72,areaHeight=paper?height-56:height*.66;
    do{
      context.font=`600 ${font}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      lines=wrapText(context,node.label,areaWidth);
      const words=String(node.label).match(/[A-Za-z0-9][A-Za-z0-9+._/-]*/g)||[];
      const widestWord=Math.max(0,...words.map(word=>context.measureText(word).width));
      if(lines.length*font*1.24<=areaHeight&&widestWord<=areaWidth)break;
      font-=2;
    }while(font>12);
    context.fillStyle=ink;context.textAlign='center';context.textBaseline='middle';
    lines.forEach((line,index)=>context.fillText(line,width/2,height/2+(index-(lines.length-1)/2)*font*1.24));
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  return {texture,width,height};
}

// A sprite keeps the circular outline circular while the user rotates a slice.
// Its world size scales naturally with distance; only paper headings have a
// small overview minimum so the document anchors remain easy to find.
export function createNodeVisual(node,palette,ink){
  const {texture}=nodeTexture(node,palette,ink);
  const visual=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false,sizeAttenuation:true,toneMapped:false,fog:false}));
  const {width:worldWidth,height:worldHeight}=nodeDimensions(node);
  visual.scale.set(worldWidth,worldHeight,1);
  const point=new THREE.Vector3();
  visual.onBeforeRender=(renderer,scene,camera)=>{
    point.setFromMatrixPosition(visual.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    const pixelsPerUnit=camera.projectionMatrix.elements[5]*renderer.domElement.clientHeight/(2*Math.max(camera.near,-point.z));
    // Keep the far-view readability floor, but no near-view pixel ceiling:
    // otherwise nodes stop growing while the camera continues to zoom in.
    const {factor}=nodeDimensions(node,pixelsPerUnit);
    visual.scale.set(worldWidth*factor,worldHeight*factor,1);visual.updateMatrixWorld();
  };
  return visual;
}

export function createLinkVisual(link,palette){
  const role=link.semanticRole||'association',viewOnly=link.basis==='view';
  const color=link.basis==='unresolved'?palette.conflict:link.paperLink?palette.paper:
    ({containment:palette.method,sequence:palette.sequence,feedback:palette.sequence,dependency:palette.dependency,rationale:palette.claim})[role]||palette.muted;
  const opacity=link.dimmed?.10:link.emphasized?.95:viewOnly?.16:role==='sequence'?.92:role==='containment'?.58:role==='dependency'?.42:.32;
  const material=link.basis==='inferred'||link.basis==='derived'||link.basis==='unresolved'||viewOnly
    ?new THREE.LineDashedMaterial({color,transparent:true,opacity,dashSize:10,gapSize:8})
    :new THREE.LineBasicMaterial({color,transparent:true,opacity});
  const object=new THREE.Group(),line=new THREE.Line(new THREE.BufferGeometry(),material);
  object.add(line);object.userData.line=line;
  if(!viewOnly){
    const arrow=new THREE.Mesh(new THREE.ConeGeometry(4.5,13,8),new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false}));
    object.add(arrow);object.userData.arrow=arrow;
  }
  // Keep semantics legible in a focused neighbourhood; a global label on every
  // edge would cover the very structure the diagram is meant to explain.
  if(link.emphasized||role==='sequence'||role==='feedback'){
    const canvas=document.createElement('canvas');canvas.width=480;canvas.height=96;
    const context=canvas.getContext('2d');context.font='600 28px -apple-system, BlinkMacSystemFont, sans-serif';
    const label=link.label||link.type,width=Math.min(476,context.measureText(label).width+36);
    context.fillStyle=palette.bg;context.globalAlpha=.94;context.beginPath();context.roundRect((480-width)/2,8,width,80,12);context.fill();context.globalAlpha=1;
    context.fillStyle=color;context.textAlign='center';context.textBaseline='middle';context.fillText(label,240,48,450);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const caption=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false,toneMapped:false}));
    object.add(caption);object.userData.caption=caption;
  }
  return object;
}

// Continuous Bezier branches for every relationship, including faint cross-links.
export function updateLinkVisual(object,start,end,link){
  const a=new THREE.Vector3(start.x,start.y,start.z),b=new THREE.Vector3(end.x,end.y,end.z);
  const radius=node=>node?.kind==='paper'?55:(node?.treeDepth===0?82:node?.treeDepth===1?74:66)*(node?.visualScale||1);
  const sourceRadius=radius(link.source),targetRadius=radius(link.target);
  const vertical=(link.treeEdge||link.type==='membership'||link.placementEdge&&link.semanticRole==='dependency')&&Math.abs(a.y-b.y)>1;
  if(vertical){
    a.y-=sourceRadius;b.y+=targetRadius;
  }else{
    const direction=b.clone().sub(a).normalize();
    a.addScaledVector(direction,sourceRadius);b.addScaledVector(direction,-targetRadius);
  }
  const gap=a.distanceTo(b);let curve;
  if(vertical){
    const drop=Math.abs(a.y-b.y)*.5;
    curve=new THREE.CubicBezierCurve3(a,new THREE.Vector3(a.x,a.y-drop,a.z),new THREE.Vector3(b.x,b.y+drop,b.z),b);
  }else{
    const middle=a.clone().lerp(b,.5);
    if(link.semanticRole==='feedback')middle.y-=Math.min(180,gap*.25);
    else if(link.semanticRole==='sequence')middle.y+=Math.min(46,gap*.1);
    else if(Math.abs(a.y-b.y)<gap*.18)middle.y+=Math.min(130,gap*.18);
    else if(link.cross)middle.z+=Math.min(160,gap*.12);
    else middle.x+=Math.min(95,gap*.1);
    curve=new THREE.QuadraticBezierCurve3(a,middle,b);
  }
  const line=object.userData.line;
  line.geometry.setFromPoints(curve.getPoints(48));
  if(line.material.isLineDashedMaterial)line.computeLineDistances();
  const scale=Math.min(link.source?.visualScale||1,link.target?.visualScale||1);
  const arrow=object.userData.arrow;
  if(arrow){
    // Point at the target on the same curve, rather than along a straight chord.
    const t=Math.max(.55,1-9*scale/Math.max(1,gap));
    arrow.position.copy(curve.getPoint(t));arrow.scale.setScalar(scale);
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),curve.getTangent(t).normalize());
  }
  const caption=object.userData.caption;
  if(caption){caption.position.copy(curve.getPoint(.5));caption.position.y+=13*scale;caption.scale.set(126*scale,25.2*scale,1);}
  return true;
}
