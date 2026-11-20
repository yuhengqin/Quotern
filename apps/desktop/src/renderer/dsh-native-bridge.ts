import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const call = (channel:string,...args:unknown[]) => invoke('desktop_request',{channel,args});
const listeners=new Map<string,Set<(value:unknown)=>void>>();
const subscribe=(channel:string,handler:(value:unknown)=>void)=>{
  const current=listeners.get(channel)??new Set();
  current.add(handler);listeners.set(channel,current);
  return ()=>current.delete(handler);
};
void listen<{channel:string;args:unknown[]}>('desktop-event',({payload})=>{
  for(const callback of listeners.get(payload.channel)??[])callback(payload.args[0]);
});
const positions = new Map<string,unknown>();
function positionKey(id:string){return 'quotern.dsh.position.'+id;}
const bridge={
  showContextMenu:(tree:unknown)=>call('dsh:context-menu',tree),
  closeContextMenu:()=>call('dsh:context-menu-close'),
  setBounds:(x:number,y:number,width:number,height:number,_boxX:number,_boxY:number,size:number,_bottom:number,_vx:number,_vy:number,marginL:number,marginT:number)=>call('dsh:bounds',{x,y,width,height,size,marginL,marginT}),
  onIdle:(cb:(v:unknown)=>void)=>subscribe('pet:idle',cb),
  onCursorPosition:(cb:(v:unknown)=>void)=>subscribe('pet:cursor-position',cb),
  readCompanionPosition(id:string){try{return positions.get(id)??JSON.parse(localStorage.getItem(positionKey(id))??'null');}catch{return null;}},
  saveCompanionPosition(id:string,state:unknown){try{localStorage.setItem(positionKey(id),JSON.stringify(state));positions.set(id,state);return true;}catch{return false;}},
  setInteractive:(value:boolean)=>call('dsh:interactive',value),
  setInputBusy:(value:boolean)=>call('dsh:busy',value),
  setInputRegions:(value:unknown)=>call('dsh:regions',value),
  openHost:()=>call('window:show'),
  // Quotern's configuration projects a single companion and disables cross-pet collisions.
  reportFlight(){},reportCollide(){},
  onFlightStates:(cb:(v:unknown)=>void)=>subscribe('pet:flight-states',cb),
  onPetHit:(cb:(v:unknown)=>void)=>subscribe('pet:hit',cb),
  onDisplays:(cb:(v:unknown)=>void)=>subscribe('pet:displays',cb),
};
Object.defineProperty(window,'petBridge',{value:bridge});
