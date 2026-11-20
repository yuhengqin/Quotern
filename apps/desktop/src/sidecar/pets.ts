import { join } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { appendJsonLog, localDateNow, logsDir, resolveDataDir } from 'quotern-core';
import type { SupportedLocale } from 'quotern-i18n';
import { PetCatalogStore } from '../main/pet-catalog-store';
import { petCatalogFailure, petCatalogMessageKey } from '../main/pet-catalog-errors';
import { NATIVE_MESSAGES, nativeText } from '../main/native-messages';
import { PetActivation } from '../main/pet-activation';
import { clampPetBounds, DEFAULT_PET_SETTINGS, normalizePetSettings, PET_BUBBLE_BAND, petDockTarget, petWindowSize, toPetStats, type Rect } from '../main/pet-core';
import { DshPetController } from '../main/dsh-pet/controller';
import { DshPetAssetStore } from '../main/dsh-pet/asset-store';
import { atomicPrivateFile } from '../main/dsh-pet/storage';
import { buildDshPetCompanion } from '../main/dsh-pet/companion';
import { buildPetContextMenu, runPetMenuCommand, withDshActions } from '../main/pet-context-menu';
import { isLocalRuntimeSyncing, localApiRequest, onLocalRuntimeSynced, onLocalRuntimeSyncActivity } from '../main/local-runtime';
import { dshPetSize, DSH_PET_WIDTHS } from '../shared/dsh-pet-size';
import type { PetCatalogRequest, PetKind, PetSelection, PetSettingPatch, PetState } from '../shared/pet';
import type { DshPetAction, RpcRequest } from '../shared/dsh-pet';
import type { ActivitySubscription } from '../shared/agent-activity';
import type { QuotaState } from '../shared/quota';
import type { NativeCall } from './service';

export async function desktopPets(profile:string, native:NativeCall, emit:(channel:string,...args:unknown[])=>void,
  quota:()=>QuotaState, refreshQuota:()=>Promise<unknown>, locale:()=>SupportedLocale, activity?:ActivitySubscription,
  catalog = new PetCatalogStore(join(profile,'pets')), logDataDir = resolveDataDir()) {
  const file=join(profile,'pet-settings.json'), root=join(profile,'dsh-pet'), runtime=join(__dirname,'dsh-pet');
  const assets=new DshPetAssetStore(root,runtime);
  let settings=DEFAULT_PET_SETTINGS;
  try{settings=normalizePetSettings(JSON.parse(await readFile(file,'utf8')));}catch(error){if ((error as NodeJS.ErrnoException).code!=='ENOENT' && !(error instanceof SyntaxError))throw error;}
  const state:PetState={currentKind:'builtin',settings,catalog:await catalog.list(),stats:toPetStats({}, {}, {}, localDateNow()),
    limits:[],connected:false,syncing:false,dark:false,locale:locale(),hover:false,miniMode:settings.docked,lookDirectionIndex:null,bubbleBand:PET_BUBBLE_BAND};
  let queue=Promise.resolve();
  function broadcast(){state.currentKind=selection.currentKind;state.settings=settings;state.locale=locale();state.miniMode=settings.docked&&!state.hover;emit('pet:state',state);}
  function update(patch:Partial<typeof settings>, visibility=false) {
    const task=queue.then(async()=>{
      const next=normalizePetSettings({...settings,...patch});
      if(!state.catalog.some(p=>p.id===next.character))throw Error('Unknown pet');
      if(visibility||next.visible)await native('pet:window',next.visible,{...petWindowSize(next.size,state.bubbleBand),position:next.position,bubbleBand:state.bubbleBand,docked:next.docked});
      await atomicPrivateFile(file,JSON.stringify(next));settings=next;broadcast();
    });
    queue=task.catch(()=>{});return task;
  }
  const sync=async()=>{const r=await localApiRequest('/functions/tud-trigger-sync',{method:'POST',body:'{}'});if(r.status!==200)throw Error('Sync failed');};
  const fish:DshPetController=new DshPetController({root,runtimeRoot:runtime,getQuota:quota,refreshQuota:async()=>{await refreshQuota();},activity,
    nativeWindow:{open:async (pets,generation)=>{await native('dsh:window',true,pets[0],generation);},close:async()=>{await native('dsh:window',false);}},
    onChanged:s=>emit('dsh-pet:changed',s),getCompanion:()=>buildDshPetCompanion(state,quota()),sync,
    showMainWindow:()=>{void native('host:open-main');},openSettings:()=>{void native('host:settings','pets');},
    openDirectory:async()=>{await native('host:fish-directory');},coordinateVisibility:(visible,fn)=>selection.run('dsh',visible,fn),
    getContextMenu:()=>menu('dsh'),onMenuCommand:id=>{void command(id,'dsh');},
  });
  const selection:PetActivation=new PetActivation({builtin:()=>settings.visible?update({visible:false},true):Promise.resolve(),dsh:()=>fish.deactivate()},{
    file:join(profile,'pet-selection.json'),isEnabled:()=>settings.visible||fish.isEnabled(),
    enable:{builtin:()=>update({visible:true},true),dsh:()=>fish.activate()},
    selectBuiltin:character=>update({character}),onChanged:()=>{emit('pet:selection:state',selection.getState());broadcast();},
  });
  function menu(kind:PetKind):ReturnType<typeof buildPetContextMenu>{return buildPetContextMenu({kind,locale:locale(),catalog:state.catalog,character:settings.character,
    size:kind==='dsh'?dshPetSize(fish.config.vendor.flattenPetList(fish.config.read())[0]?.size):settings.size,dshAvailable:true,syncing:isLocalRuntimeSyncing()});}
  const command=(id:string,kind:PetKind)=>runPetMenuCommand(id,kind,{getMenu:menu,open:async()=>{await native('host:open-main');},sync,
    hide:()=>selection.setEnabled(false),select:t=>selection.select(t),settings:async target=>{await native('host:settings',target);},
    size:async(kind,size)=>{if(kind==='builtin')await update({size});else {const petId=fish.config.petId();if(petId)await fish.dispatch({type:'patch-pet',petId,patch:{size:DSH_PET_WIDTHS[size]}});}},
  });
  await selection.initialize();
  async function catalogRequest(req:PetCatalogRequest) {
    try{
      if(!req||typeof req!=='object')throw Error(nativeText(locale(),'native.pet.invalidOperation'));
      if(req.action==='list-codex')return {ok:true,data:await catalog.listCodex()};
      let pet;
      if(req.action==='import-zip'){const path=await native('host:pick-pet');if(typeof path!=='string'||!path)return {ok:true,data:{canceled:true}};if((await stat(path)).size>12*1024*1024)throw Error(nativeText(locale(),'native.pet.zipTooLarge'));pet=await catalog.installZip(await readFile(path));}
      else if(req.action==='install-url'){if(typeof req.url!=='string')throw Error(nativeText(locale(),'native.pet.invalidUrl'));pet=await catalog.installFromUrl(req.url);}
      else if(req.action==='import-codex')await catalog.importCodex(req.ids);
      else if(req.action==='restore-builtins')await catalog.restoreBuiltins();
      else if(req.action==='remove')await catalog.remove(req.id);
      else throw Error(nativeText(locale(),'native.pet.unsupportedOperation'));
      state.catalog=await catalog.list();if(!state.catalog.some(p=>p.id===settings.character))await update({character:'clawd'});
      broadcast();return {ok:true,data:{catalog:state.catalog,pet}};
    }catch(error){
      const diagnostic=petCatalogFailure(req,error);
      await appendJsonLog(join(logsDir(logDataDir),'pet-import.log'),diagnostic);
      const message=error instanceof Error?error.message:'';
      const currentLocale=locale(), key=petCatalogMessageKey(error);
      if(key)return {ok:false,error:nativeText(currentLocale,key,{status:String(diagnostic.httpStatus??'')})};
      return {ok:false,error:currentLocale==='zh-CN'||Object.values(NATIVE_MESSAGES[currentLocale]).includes(message)
        ?(message||nativeText(currentLocale,'native.pet.operationFailed')):nativeText(currentLocale,'native.pet.operationFailed')};
    }
  }
  let refreshing:Promise<void>|undefined;
  function refresh(){
    if(refreshing)return refreshing;
    refreshing=(async()=>{
      const routes=['usage-summary','usage-daily?days=365','usage-model-breakdown?days=30','usage-sessions?days=1'];
      const responses=await Promise.all(routes.map(r=>localApiRequest('/functions/tud-'+r)));
      const [s,d,b,c]=responses.map(r=>(r.body as {data:Record<string,never>})?.data??{});
      if(responses[0]!.status!==200){state.connected=false;broadcast();return;}
      const previous=state.stats;
      state.stats=toPetStats(s!,d!,b!,localDateNow(),c);state.connected=true;
      state.limits=quota().providers.filter(p=>p.status==='ready'&&!p.stale).flatMap(p=>p.windows.filter(w=>w.analysisEligible!==false&&w.usedPercent>0&&w.usedPercent<100).map(w=>({provider:p.label,window:[w.groupLabel,w.label].filter(Boolean).join(' '),usedPercent:w.usedPercent,resetAt:w.resetsAt}))).sort((a,b)=>b.usedPercent-a.usedPercent);
      if(previous.todayTokens&&state.stats.todayTokens>previous.todayTokens)emit('pet:event',{type:'pet:model-status',detail:{tokensDelta:state.stats.todayTokens-previous.todayTokens,costDelta:Math.max(0,state.stats.todayCostUsd-previous.todayCostUsd)}});
      broadcast();
    })().finally(()=>{refreshing=undefined;});return refreshing;
  }
  const offSync=onLocalRuntimeSynced(()=>{if(settings.visible||fish.isEnabled())void refresh().catch(console.error);});
  const offActivity=onLocalRuntimeSyncActivity(active=>{if(state.syncing!==active){state.syncing=active;broadcast();}});
  return {
    fishWindowClosed:(generation: unknown)=>fish.nativeWindowClosed(generation),
    async start(){if(selection.currentKind==='dsh'&&fish.isEnabled())await fish.initialize();else if(settings.visible)await selection.setEnabled(true);},
    async request(channel:string,args:unknown[]){
      const [value,other]=args;
      switch(channel){
        case 'pet:get':if(settings.visible||fish.isEnabled())void refresh().catch(console.error);return state;
        case 'pet:selection:get':return selection.getState();
        case 'pet:enable':await selection.setEnabled(value as boolean);return selection.getState();
        case 'pet:select':await selection.select(value as PetSelection);return selection.getState();
        case 'pet:set':{const patch=value as PetSettingPatch;if(!patch||Object.keys(patch).some(k=>!['visible','size','character','botColor'].includes(k)))throw Error('Invalid pet preferences');await selection.run('builtin',patch.visible===true,()=>update(patch,typeof patch.visible==='boolean'));return state;}
        case 'pet:catalog':return catalogRequest(value as PetCatalogRequest);
        case 'pet:menu':return value==='dsh'?withDshActions(menu('dsh'),other):menu('builtin');
        case 'pet:menu-command':return command(String(value),other==='dsh'?'dsh':'builtin');
        case 'pet:command':if(value==='hide')return selection.setEnabled(false);if(value==='sync')return sync();
          if(typeof value==='string'&&value.startsWith('bubble-height:')) {const n=Number(value.slice(14));if(Number.isFinite(n)&&n>0&&Math.round(n)!==state.bubbleBand){state.bubbleBand=Math.max(PET_BUBBLE_BAND,Math.min(900,Math.round(n)));return update({});}} return;
        case 'pet:placed': {
          const point = value as {x:number;y:number}, work = other as Rect;
          if (![point?.x,point?.y,work?.x,work?.y,work?.width,work?.height].every(Number.isFinite)) throw Error('Invalid placement');
          const size = petWindowSize(settings.size, state.bubbleBand);
          const bounded = clampPetBounds(point,size,work);
          const placement = petDockTarget({...point,y:bounded.y},size,work,false,false,state.bubbleBand);
          await update({position:placement.docked?{x:placement.x,y:placement.y}:bounded,docked:placement.docked});
          return;
        }
        case 'pet:theme':state.dark=value===true;broadcast();return;
        case 'pet:hover':state.hover=value===true;state.lookDirectionIndex=typeof other==='number'?other:null;broadcast();return;
        case 'pet:atlas':if((value==='asset'||value==='codex')&&typeof other==='string')return (await catalog.readAtlas(value,other)).toString('base64');throw Error('Invalid pet atlas');
        case 'dsh-pet:get':return fish.getState();
        case 'dsh-pet:action':return fish.dispatch(value as DshPetAction);
        case 'dsh:resource':{
          const req=value as RpcRequest;
          if(req.method==='GET'&&/^\/dsh-pet-7340\/(?:thumb|pic|font)\//.test(req.url)){
            const asset=await assets.resolve(req.url);return asset?{status:200,...asset}:{status:404};
          }
          return fish.handleNativeRequest(req);
        }
        default:throw Error('Unknown pet operation');
      }
    },
    async close(){offSync();offActivity();await fish.dispose();await queue;},
  };
}
