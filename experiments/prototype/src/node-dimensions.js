// Shared by drawing and navigation hit testing, including the overview's
// minimum readable size. Pixel dimensions must match the visible sprite.
export function nodeDimensions(node,pixelsPerUnit=1){
  const paper=node.kind==='paper',scale=node.visualScale||1;
  const width=(paper?300:node.treeDepth===0?164:node.treeDepth===1?148:132)*scale;
  const height=paper?width*264/720:width;
  const minimum=paper?(node.overview?52:118):3;
  const factor=Math.max(minimum/(width*pixelsPerUnit),1);
  return {width,height,factor,pixelWidth:width*pixelsPerUnit*factor,pixelHeight:height*pixelsPerUnit*factor};
}
