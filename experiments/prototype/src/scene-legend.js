// Keep this overlay inside the graph viewport so it never changes canvas size.
export function setupSceneLegend(root=document){
  const legend=root.getElementById('scene-legend');
  const toggle=root.getElementById('scene-legend-toggle');
  const content=root.getElementById('scene-legend-content');
  const scene=root.getElementById('scene');
  const footer=root.getElementById('scene-footer');
  const onToggle=()=>{
    const collapsed=toggle.getAttribute('aria-expanded')==='true';
    legend.classList.toggle('is-collapsed',collapsed);
    content.hidden=collapsed;
    toggle.setAttribute('aria-expanded',String(!collapsed));
    toggle.setAttribute('aria-label',collapsed?'展开图例':'最小化图例');
    toggle.title=collapsed?'展开图例':'最小化图例';
  };
  toggle.addEventListener('click',onToggle);

  // The instructions wrap when the reader expands or the viewport narrows.
  // Reserve their actual height rather than letting the legend cover them.
  const reserveFooter=()=>scene.style.setProperty('--scene-footer-height',`${footer.getBoundingClientRect().height}px`);
  const observer=new ResizeObserver(reserveFooter);
  observer.observe(footer);
  reserveFooter();
  return {dispose(){toggle.removeEventListener('click',onToggle);observer.disconnect();}};
}
