(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.NuglyanSessionStore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const DEFAULT_KEY='nuglyan.admin.session.v1';
  function create(storage,key=DEFAULT_KEY){
    function read(){
      if(!storage)return null;
      try{
        const raw=storage.getItem(key);
        if(!raw)return null;
        const value=JSON.parse(raw);
        if(typeof value?.access_token!=='string'||!value.access_token||typeof value?.refresh_token!=='string'||!value.refresh_token||!Number.isFinite(Number(value.expires_at))){
          storage.removeItem(key);
          return null;
        }
        return {access_token:value.access_token,refresh_token:value.refresh_token,expires_at:Number(value.expires_at)};
      }catch{
        try{storage.removeItem(key);}catch{}
        return null;
      }
    }
    function write(value){
      if(!storage)return false;
      if(typeof value?.access_token!=='string'||typeof value?.refresh_token!=='string'||!Number.isFinite(Number(value.expires_at)))return false;
      try{storage.setItem(key,JSON.stringify({access_token:value.access_token,refresh_token:value.refresh_token,expires_at:Number(value.expires_at)}));return true;}catch{return false;}
    }
    function clear(){if(!storage)return;try{storage.removeItem(key);}catch{}}
    return {read,write,clear,key};
  }
  return {create,DEFAULT_KEY};
});
