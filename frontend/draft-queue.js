(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.NuglyanDraftQueue=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function create(options={}){
    if(typeof options.save!=='function')throw new TypeError('Draft queue requires a save function');
    const delay=Number.isFinite(options.delay)?Math.max(0,options.delay):650;
    const maxRetries=Number.isInteger(options.maxRetries)?Math.max(0,options.maxRetries):3;
    const retryBase=Number.isFinite(options.retryBase)?Math.max(1,options.retryBase):500;
    const retryMax=Number.isFinite(options.retryMax)?Math.max(retryBase,options.retryMax):5000;
    const shouldRetry=typeof options.shouldRetry==='function'?options.shouldRetry:()=>true;
    const setTimer=options.setTimeout||setTimeout;
    const clearTimer=options.clearTimeout||clearTimeout;
    const pending=new Map();
    function state(record){
      if(!pending.has(record.id))pending.set(record.id,{record,timer:null,tail:Promise.resolve(),dirty:false,saving:false,error:null,status:null,retries:0});
      return pending.get(record.id);
    }
    function setStatus(p,message){if(p.status)p.status.textContent=message;}
    function clearScheduled(p){if(p.timer!==null){clearTimer(p.timer);p.timer=null;}}
    function schedule(p,wait){
      clearScheduled(p);
      p.timer=setTimer(()=>{p.timer=null;flush(p.record).catch(()=>{});},wait);
    }
    function queue(record,status){
      const p=state(record);
      p.record=record;
      if(status)p.status=status;
      p.dirty=true;
      p.retries=0;
      setStatus(p,'Есть несохранённые изменения…');
      schedule(p,delay);
    }
    function flush(record){
      const p=state(record);
      clearScheduled(p);
      const task=p.tail.catch(()=>undefined).then(async()=>{
        if(!p.dirty)return undefined;
        p.dirty=false;
        p.saving=true;
        setStatus(p,'Сохраняем изменения на сервере…');
        try{
          const result=await options.save(record);
          p.error=null;
          p.retries=0;
          if(!p.dirty)setStatus(p,'Черновик сохранён на сервере');
          return result;
        }catch(error){
          p.dirty=true;
          p.error=error;
          const retryable=shouldRetry(error)!==false;
          p.retries+=1;
          if(retryable&&p.retries<=maxRetries){
            const wait=Math.min(retryBase*Math.pow(2,p.retries-1),retryMax);
            setStatus(p,'Не удалось сохранить. Повторим автоматически…');
            if(p.timer===null)schedule(p,wait);
          }else{
            setStatus(p,error?.code==='version_conflict'
              ?'Конфликт версий. Данные не перезаписаны. Скачай резервную копию и сверь изменения.'
              :'Не удалось сохранить. Изменения остались в памяти страницы. Скачай резервную копию и повтори сохранение.');
          }
          throw error;
        }finally{
          p.saving=false;
        }
      });
      p.tail=task;
      return task;
    }
    function flushAll(){return Promise.all([...pending.values()].map(p=>flush(p.record)));}
    function hasUnsaved(){return [...pending.values()].some(p=>p.dirty||p.saving||p.timer!==null);}
    function clear(){for(const p of pending.values())clearScheduled(p);pending.clear();}
    return {queue,flush,flushAll,hasUnsaved,clear,pending};
  }
  return {create};
});
