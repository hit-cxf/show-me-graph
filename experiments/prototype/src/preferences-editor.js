export function setupPreferencesEditor({onChanged}) {
  const $=id=>document.getElementById(id);
  const dialog=$('preferences-dialog'),input=$('preferences-prompt'),message=$('preferences-message');
  let snapshot=null,baseline='',editRevision=null,dirty=false,busy=false;
  const promptOf=data=>data?.preferences?.maintenance_prompt||'';
  const report=text=>{message.textContent=text;};
  const update=()=>{
    $('preferences-save').disabled=busy||!snapshot;
    $('preferences-reload').disabled=busy||!snapshot;
    $('preferences-close').disabled=busy;
    input.disabled=busy;
    $('preferences-count').textContent=`${input.value.length.toLocaleString()} / 20,000`;
  };
  const loadSaved=()=>{
    baseline=promptOf(snapshot);input.value=baseline;editRevision=snapshot.revision;dirty=false;
    report(baseline?'已载入这份知识库的维护偏好。':'尚未设置额外偏好，可在下方填写维护提示词。');
    update();
  };
  const refresh=next=>{
    snapshot=next;
    if(busy)return;
    if(!dirty){loadSaved();return;}
    if(promptOf(next)!==baseline){
      report('偏好已被另一端更新。你的草稿已保留；请先核对，或点击“载入已保存偏好”读取最新内容。');
    }else{
      // Other knowledge edits do not invalidate this unchanged preference draft.
      editRevision=next.revision;
    }
    update();
  };
  const open=()=>{
    if(!snapshot)return;
    if(!dirty)loadSaved();
    if(!dialog.open)dialog.showModal();
  };
  $('preferences-open').onclick=open;
  $('preferences-close').onclick=()=>dialog.close();
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  input.oninput=()=>{dirty=input.value!==baseline;update();};
  $('preferences-reload').onclick=async()=>{
    if(busy)return;
    busy=true;update();
    try{await onChanged();loadSaved();}
    catch(error){report(`读取失败：${error.message}。草稿已保留。`);}
    finally{busy=false;update();}
  };
  $('preferences-save').onclick=async()=>{
    if(busy||!snapshot)return;
    if(input.value.length>20000){report('提示词最多可填写 20,000 个字符。');return;}
    const value=input.value;
    busy=true;update();report('正在保存偏好…');
    try{
      const response=await fetch('/api/knowledge/preferences',{
        method:'PUT',headers:{'Content-Type':'application/json','If-Match':`"${editRevision}"`,'X-SMG-Actor':'human'},
        body:JSON.stringify({maintenance_prompt:value}),
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);
      baseline=result.preferences.maintenance_prompt;editRevision=result.revision;dirty=false;
      snapshot={...snapshot,revision:result.revision,preferences:result.preferences};
      let refreshFailed=false;
      await onChanged().catch(()=>{refreshFailed=true;});loadSaved();
      report(refreshFailed?'偏好已保存，页面同步暂时失败，稍后可重新载入。':promptOf(snapshot)===value?'已保存。Agent 下次维护时会读取这些偏好。':'已保存；偏好随后又有更新，当前显示最新内容。');
    }catch(error){
      await onChanged().catch(()=>{});
      report(`保存失败：${error.message}。草稿已保留，请核对最新偏好后重试。`);
    }finally{busy=false;update();}
  };
  update();
  return {open,refresh};
}
