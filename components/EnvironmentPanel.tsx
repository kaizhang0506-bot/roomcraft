"use client";

import {useState} from 'react';
import {Cloud,CloudRain,Moon,Pause,Play,Sun,X} from 'lucide-react';
import {ENVIRONMENT_LOCATIONS,isEnvironmentDate,type EnvironmentSettings,type EnvironmentState} from '@/lib/environment';
import './environment-panel.css';

type Props = {
  settings: EnvironmentSettings; hour: number; north: number; state: EnvironmentState;
  onSettingsChange: (patch: Partial<EnvironmentSettings>) => void;
  onHourChange: (hour: number) => void; onNorthChange: (north: number) => void;
  playing: boolean; onPlayingChange: (playing: boolean) => void; onClose: () => void;
};
const formatTime=(hour:number)=>{const minutes=((Math.round(hour*60)%1440)+1440)%1440;return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;};
const roundedHour=(hour:number)=>Math.max(0,Math.min(23.5,Math.round(hour*2)/2));

function Coordinate({label,value,min,max,onChange}:{label:string;value:number;min:number;max:number;onChange:(value:number)=>void}){
  const [text,setText]=useState('');const [editing,setEditing]=useState(false);
  return <label>{label}<input aria-label={label} type="number" min={min} max={max} step="0.01" value={editing?text:value} onFocus={()=>{setText(String(value));setEditing(true);}} onChange={event=>setText(event.target.value)} onBlur={()=>{setEditing(false);if(text.trim()&&Number.isFinite(Number(text)))onChange(Math.max(min,Math.min(max,Number(text))));}} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}/></label>;
}

export default function EnvironmentPanel({settings,hour,north,state,onSettingsChange,onHourChange,onNorthChange,playing,onPlayingChange,onClose}:Props){
  const [customLocation,setCustomLocation]=useState(false);
  const preset=ENVIRONMENT_LOCATIONS.find(item=>Math.abs(item.latitude-settings.latitude)<.001&&Math.abs(item.longitude-settings.longitude)<.001&&item.utcOffset===settings.utcOffset);
  const location=customLocation?'custom':preset?.name??'custom';
  const setTime=(next:number)=>{onPlayingChange(false);onHourChange(next);};
  const presets:[string,number|null][]=[['日出',state.sunriseHour],['上午',9],['正午',12],['日落',state.sunsetHour],['夜晚',20]];
  return <section className="roomcraft-sun-panel roomcraft-environment-panel" role="group" aria-label="日照与朝向设置">
    <header><div><Sun size={15}/><strong>环境与日照</strong></div><button className="environment-close" onClick={onClose} aria-label="关闭环境设置"><X size={16}/></button></header>
    <label className="environment-toggle"><span>显示窗外环境</span><input type="checkbox" checked={settings.enabled} onChange={event=>onSettingsChange({enabled:event.target.checked})}/></label>
    <div className="environment-choice" role="group" aria-label="天气选择">{([{id:'clear',label:'晴天',Icon:Sun},{id:'cloudy',label:'多云',Icon:Cloud},{id:'rain',label:'雨天',Icon:CloudRain}] as const).map(({id,label,Icon})=><button key={id} aria-pressed={settings.weather===id} onClick={()=>onSettingsChange({weather:id})}><Icon size={13}/>{label}</button>)}</div>
    <label className="environment-row">窗外景观<select aria-label="窗外景观" value={settings.landscape} onChange={event=>onSettingsChange({landscape:event.target.value as EnvironmentSettings['landscape']})}><option value="garden">庭院与绿地</option><option value="city">城市街区</option><option value="none">开阔地面</option></select></label>
    <div className="environment-time-heading"><span>时间 <output>{formatTime(hour)}</output></span><button className="environment-play" onClick={()=>onPlayingChange(!playing)} aria-pressed={playing} aria-label={playing?'暂停昼夜变化':'播放昼夜变化'}>{playing?<Pause size={12}/>:<Play size={12}/>} {playing?'暂停':'昼夜播放'}</button></div>
    <input className="environment-range" aria-label="日照时间" type="range" min="0" max="23.5" step=".5" value={hour} onChange={event=>setTime(Number(event.target.value))}/>
    <div className="environment-choice environment-time-presets">{presets.map(([label,time])=><button key={label} disabled={time===null} title={time===null?'这个地点在所选日期没有对应时刻':`${label} ${formatTime(time)}`} aria-pressed={time!==null&&Math.abs(hour-roundedHour(time))<.01} onClick={()=>time!==null&&setTime(roundedHour(time))}>{label}</button>)}</div>
    <label className="environment-label">户型正北方向 <output>{north}°</output><input className="environment-range" aria-label="户型正北方向" type="range" min="-180" max="180" step="5" value={north} onChange={event=>onNorthChange(Number(event.target.value))}/></label>
    <details className="environment-details"><summary>日期与地点 <span>{settings.date} · {preset&&!customLocation?preset.name:'自定义'}</span></summary>
      <label className="environment-row">模拟日期<input aria-label="模拟日期" type="date" min="1900-01-01" max="2100-12-31" value={settings.date} onChange={event=>{if(isEnvironmentDate(event.target.value))onSettingsChange({date:event.target.value});}}/></label>
      <label className="environment-row">地点<select aria-label="模拟地点" value={location} onChange={event=>{const selected=ENVIRONMENT_LOCATIONS.find(item=>item.name===event.target.value);setCustomLocation(!selected);if(selected)onSettingsChange({latitude:selected.latitude,longitude:selected.longitude,utcOffset:selected.utcOffset});}}>{ENVIRONMENT_LOCATIONS.map(item=><option key={item.name} value={item.name}>{item.name}</option>)}<option value="custom">自定义坐标</option></select></label>
      {location==='custom'&&<div className="environment-coordinates"><Coordinate label="纬度" value={settings.latitude} min={-90} max={90} onChange={latitude=>onSettingsChange({latitude})}/><Coordinate label="经度" value={settings.longitude} min={-180} max={180} onChange={longitude=>onSettingsChange({longitude})}/><Coordinate label="UTC 时差" value={settings.utcOffset} min={-12} max={14} onChange={utcOffset=>onSettingsChange({utcOffset})}/></div>}
      <div className="environment-sun-times"><span>日出 {state.sunriseHour===null?'—':formatTime(state.sunriseHour)}</span><span>日落 {state.sunsetHour===null?'—':formatTime(state.sunsetHour)}</span></div>
    </details>
    <div className="environment-light-heading"><strong>室内灯光</strong><span>{Math.round(state.indoorLightLevel*100)}%</span></div>
    <div className="environment-choice" role="group" aria-label="室内灯光模式">{([{id:'auto',label:'天黑自动亮'},{id:'on',label:'开启'},{id:'off',label:'关闭'}] as const).map(({id,label})=><button key={id} aria-pressed={settings.indoorLights===id} onClick={()=>onSettingsChange({indoorLights:id})}>{label}</button>)}</div>
    <label className="environment-label">灯光亮度 <output>{Math.round(settings.indoorIntensity*100)}%</output><input className="environment-range" aria-label="室内灯光亮度" type="range" min="0" max="1" step=".05" value={settings.indoorIntensity} onChange={event=>onSettingsChange({indoorIntensity:Number(event.target.value)})}/></label>
    <div className="environment-astronomy"><span><Sun size={12}/> 太阳 {state.sunAltitude.toFixed(1)}°</span><span><Moon size={12}/> 月面照亮 {Math.round(state.moonIllumination*100)}%</span></div>
    <p className="environment-note">按日期与地点模拟，天气手动选择。月相及月亮位置近似；低于地平线时不显示。灯具为预览，未写入施工图。</p>
  </section>;
}
