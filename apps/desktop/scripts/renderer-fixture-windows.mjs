import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtureIpc,FixtureWindow} from './renderer-fixture.mjs';

const index=fileURLToPath(new URL('../out/renderer/index.html',import.meta.url));
let panel, target, dialog=false, serial=0;
export function createTrayPopover(){
  for(const key of ['quota:navigation:get','quota:navigation:ack','quota:dialog-state','tray-popover:resize'])fixtureIpc.removeHandler(key);
  fixtureIpc.handle('quota:navigation:get',()=>target??null);
  fixtureIpc.handle('quota:navigation:ack',(_,id)=>{if(target?.requestId===id)target=null;});
  fixtureIpc.handle('quota:dialog-state',(_,open)=>{dialog=open;});
  fixtureIpc.handle('tray-popover:resize',(_,height)=>panel?.setSize(446,Math.max(216,Math.min(716,height))));
}
export async function showQuotaPopover(value){
  if(value) target={...value,requestId:String(++serial)};
  if(!panel||panel.isDestroyed()){
    panel=new FixtureWindow({desktop:true,width:446,height:216,show:false});
    panel.on('blur',()=>panel.hide());
    panel.webContents.on('before-input-event',(_,input)=>{if(input.type==='keyDown'&&input.key==='Escape'&&!dialog)panel.hide();});
    await panel.loadFile(index,{query:{view:'tray-popover'}});
  }
  await panel.show();
  if(value)panel.webContents.send('quota:navigation');
}
export function destroyTrayPopover(){
  panel?.destroy();panel=undefined;target=null;dialog=false;
  for(const key of ['quota:navigation:get','quota:navigation:ack','quota:dialog-state','tray-popover:resize'])fixtureIpc.removeHandler(key);
}
let palette;
export class FixtureMainWindow{
  constructor({theme}){
    this.window=new FixtureWindow({desktop:true,width:1160,height:780});
    this.setThemeBackground(theme,'default');
    void this.window.loadFile(index);
  }
  setThemeBackground(theme,style){
    const apply=window=>{
      window.background=palette?.(theme,style).background??(theme==='dark'?'#050607':'#f5f5f5');
      for(const child of window.references)apply(child);
    };
    apply(this.window);
  }
}
export async function registerAppearanceIpc(profile,apply){
  const {appearanceChrome}=await import('../out/main/appearance-shared-test.mjs');
  const {createAppearanceController}=await import('../out/main/appearance-controller-test.mjs');
  const store=await import('../out/main/appearance-store-test.mjs');
  palette=appearanceChrome;
  const controller=createAppearanceController({
    read:()=>store.readAppearancePreferences(profile),write:value=>store.writeAppearancePreferences(profile,value),
    apply,publish:value=>{for(const w of FixtureWindow.getAllWindows())w.webContents.send('appearance:changed',value);},
  });
  const pairs=[['appearance:get',controller.get],['appearance:set',controller.set],['appearance:initialize',controller.initialize]];
  for(const [channel,handler] of pairs)fixtureIpc.handle(channel,(_,value)=>handler(value));
  return ()=>{for(const [channel] of pairs)fixtureIpc.removeHandler(channel);};
}
