"use client";

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Box, Check, Clipboard, Compass, Download, ExternalLink, FileCode2, Layers2, LoaderCircle, Palette, PencilRuler, RotateCcw, ScanLine, Settings2, Sofa, Sparkles, Upload } from 'lucide-react';
import { STYLE_OPTIONS, type Plan } from '@/lib/plan';
import { validatePlan } from '@/lib/validation';
import { DESIGN_SKILLS, DESIGN_SOURCES, createDesignTask, type CapabilityAction, type CapabilityHealth, type DesignSkillId, type ServiceState } from '@/lib/design-capabilities';
import './design-capabilities.css';

type Props = {
  plan: Plan; styleId: string; initialBrief: string; hasImage: boolean; busy: boolean;
  onAction: (action: CapabilityAction) => void;
  onApply: (draft: Plan, source: string) => void;
};
type Tab = 'workflow' | 'assistant' | 'sources';
type Draft = {plan: Plan; source: string; summary: string};
const STATES: Record<ServiceState, string> = {ready: '本地服务可达', configured: '参数已配置', unavailable: '服务未就绪', missing: '待配置'};

function downloadText(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], {type: 'text/markdown;charset=utf-8'}));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function DesignCapabilities({plan, styleId, initialBrief, hasImage, busy, onAction, onApply}: Props) {
  const [tab, setTab] = useState<Tab>('workflow');
  const [services, setServices] = useState<CapabilityHealth | null>(null);
  const [healthError, setHealthError] = useState('');
  const [healthLoading, setHealthLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [brief, setBrief] = useState(initialBrief);
  const [skillId, setSkillId] = useState<DesignSkillId>('interior-design-expert');
  const [message, setMessage] = useState('');
  const [designError, setDesignError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const source = JSON.stringify(plan);
  const stale = !!draft && draft.source !== source;
  const skill = DESIGN_SKILLS.find(item => item.id === skillId)!;
  const style = STYLE_OPTIONS.find(item => item.id === styleId)?.name || '当前风格';

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/capabilities', {signal: controller.signal}).then(async response => {
      if (!response.ok) throw new Error('状态查询失败，请重试。');
      const data = await response.json() as {services: CapabilityHealth};
      setServices(data.services);
    }).catch(error => { if (!controller.signal.aborted) {setServices(null);setHealthError(error instanceof Error ? error.message : '状态查询失败');} })
      .finally(() => { if (!controller.signal.aborted) setHealthLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => () => abortRef.current?.abort(), []);

  async function propose() {
    if (generating || busy) return;
    const controller = new AbortController(); abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 180000);
    setGenerating(true); setDraft(null); setDesignError('');
    try {
      const response = await fetch('/api/design', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({plan, style: styleId, prompt: brief}), signal: controller.signal});
      const data = await response.json() as {error?: string; plan?: unknown; summary?: string};
      if (!response.ok) throw new Error(data.error || '生成方案失败');
      const next = validatePlan(data.plan);
      if (!controller.signal.aborted) setDraft({plan: next, source, summary: data.summary || '请核对家具尺寸和通行空间。'});
    } catch (error) {
      setDesignError(controller.signal.aborted ? '已停止等待，当前项目未修改。服务端可能仍在处理本次请求。' : error instanceof Error ? error.message : '方案生成失败');
    } finally { clearTimeout(timeout); setGenerating(false); abortRef.current = null; }
  }

  async function copyTask() {
    const text = createDesignTask(plan, skillId, brief, style);
    try { await navigator.clipboard.writeText(text); setMessage('已复制任务与当前户型，可粘贴到 Codex 执行。'); }
    catch { setMessage('浏览器未允许复制，请下载任务文件。'); }
  }

  const steps = [
    {action: 'upload' as const, title: '上传户型', detail: '图片、PDF、DXF 或项目文件', icon: Upload},
    {action: 'house' as const, title: '识别与还原', detail: hasImage ? '选择 House 墙线识别' : '先上传，再识别墙体与门窗', icon: ScanLine},
    {action: 'correction' as const, title: '校正结构', detail: '逐项核对尺寸、门窗、房间', icon: PencilRuler},
    {action: 'furniture' as const, title: '布置家具', detail: '选择家具，拖动与调整尺寸', icon: Sofa},
    {action: 'materials' as const, title: '搭配材质', detail: '地面、墙面与家具表面', icon: Palette},
    {action: 'space' as const, title: '三维与光追', detail: '自由漫游；当前视角出图', icon: Box},
    {action: 'photo' as const, title: '全景预览', detail: '360° 环顾，切换房间节点', icon: Compass},
    {action: 'render' as const, title: '设计效果', detail: '图片对照与生成漫游空间', icon: Sparkles},
    {action: 'professional' as const, title: '专业编辑', detail: '将户型导入 Pascal 单独编辑', icon: Layers2},
    {action: 'export' as const, title: '导出与交付', detail: '项目、DXF、单房间尺寸草图', icon: Download},
  ];

  return <div className="design-capabilities">
    <div className="capability-intro"><div><span className="eyebrow">FROM PLAN TO PLACE</span><h3>让工具围绕你的设计工作。</h3><p>继续当前项目，从读图、布置到预览与出图。</p></div><div className="capability-project"><strong>{plan.name}</strong><span>{plan.rooms.length} 个房间 · {plan.furniture.length} 件家具</span></div></div>
    <div className="capability-tabs" role="tablist" aria-label="设计能力分类">
      {([{id:'workflow',label:'设计流程'}, {id:'assistant',label:'AI 设计助理'}, {id:'sources',label:'技能与接入状态'}] as const).map(item => <button key={item.id} role="tab" id={`cap-tab-${item.id}`} aria-selected={tab===item.id} aria-controls={`cap-panel-${item.id}`} onClick={() => setTab(item.id)}>{item.label}</button>)}
    </div>
    {tab==='workflow' && <div role="tabpanel" id="cap-panel-workflow" aria-labelledby="cap-tab-workflow">
      <div className="capability-flow">{steps.map(({action,title,detail,icon:Icon}, i) => <button className="capability-tile" key={action} onClick={() => onAction(action)} disabled={busy}><span className="capability-tile-top"><Icon size={19}/><small>{String(i+1).padStart(2,'0')}</small></span><strong>{title}</strong><span>{detail}</span><ArrowRight size={14} className="capability-arrow"/></button>)}</div>
      <div className="capability-explainer"><strong>编辑、全景和出图，各有自己的用途。</strong><p>三维空间可以自由移动和编辑家具；全景可以转头查看；AI 效果图可以拖动、放大查看。照片本身不能逐件移动家具，实时三维的真实感也仍取决于模型、材质和光照。</p></div>
      <button className="capability-assistant-entry" onClick={() => setTab('assistant')}><Sparkles size={18}/><span><strong>用一句话描述你的设计</strong><small>先生成家具方案，确认后再应用</small></span><ArrowRight size={17}/></button>
    </div>}
    {tab==='assistant' && <div role="tabpanel" id="cap-panel-assistant" aria-labelledby="cap-tab-assistant">
      <label className="capability-brief"><span>你想怎样设计这个空间？<small>{style}</small></span><textarea aria-label="设计助理需求" value={brief} maxLength={2000} rows={4} onChange={event => setBrief(event.target.value)} placeholder="例如：客厅留出宽敞动线，主卧增加收纳，采用浅木色和亚麻，家具尽量简洁。"/></label>
      <p className="capability-help">网页助理按需求重新布置全屋家具，墙体、门窗与水电保留。生成后先看方案，再选择是否应用；使用已配置模型的账户额度。</p>
      <div className="capability-actions"><button className="button button-dark" disabled={generating || busy || !plan.rooms.length || !plan.walls.length || !brief.trim() || services?.design!=='configured'} onClick={() => void propose()}>{generating ? <LoaderCircle size={15} className="spin"/> : <Sparkles size={15}/>}生成家具方案草稿</button>{generating ? <button className="button button-light" onClick={() => abortRef.current?.abort()}>停止等待</button> : services?.design!=='configured' && <button className="button button-light" onClick={() => onAction('settings')}>配置设计模型</button>}</div>
      {!plan.rooms.length && <p className="capability-help">先识别或绘制房间，即可生成家具方案。</p>}
      {designError && <p className="capability-error" role="alert">{designError}</p>}
      {draft && <section className="capability-draft" aria-label="待应用家具方案"><span className="eyebrow">DESIGN PROPOSAL</span><h4>新家具方案 · {draft.plan.furniture.length} 件</h4><p>{draft.summary}</p><ul>{draft.plan.furniture.slice(0,8).map(item => <li key={item.id}><span>{item.name}</span><small>{item.width} × {item.depth} × {item.height} m</small></li>)}</ul>{draft.plan.furniture.length>8 && <p className="capability-help">另有 {draft.plan.furniture.length-8} 件家具，应用后可逐件查看。</p>}<p className="capability-help">应用后替换当前 {plan.furniture.length} 件家具，可通过“撤销”恢复。请核对相互遮挡与通行空间。</p>{stale && <p className="capability-error" role="alert">项目已变化，请基于最新户型重新生成。</p>}<button className="button button-dark" disabled={stale || busy || generating} onClick={() => { try { onApply(draft.plan,draft.source); } catch (error) { setDesignError(error instanceof Error ? error.message : '无法应用方案'); } }}><Check size={15}/>应用方案并查看三维</button></section>}
      <section className="capability-skill-task"><div className="capability-section-heading"><FileCode2 size={19}/><div><h4>需要更深入的设计？交给 Codex 技能。</h4><p>导出当前户型和需求，在 Codex 中执行。兼容的项目 JSON 可导回网站，ArchLang 图纸需另行转换。</p></div></div>
        <label>选择任务<select aria-label="设计技能" value={skillId} onChange={event => {setSkillId(event.target.value as DesignSkillId);setMessage('');}}>{DESIGN_SKILLS.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><p>{skill.detail}</p><p className="capability-help">{skill.requirement}</p>
        <div className="capability-actions"><button className="button button-light" onClick={() => void copyTask()}><Clipboard size={14}/>复制 Codex 任务</button><button className="button button-light" onClick={() => {downloadText(createDesignTask(plan,skillId,brief,style),`Roomcraft-${skillId}-任务.md`);setMessage('已下载任务文件，包含当前可编辑户型，不含图片和服务密钥。');}}><Download size={14}/>下载任务文件</button></div>{message && <p className="capability-help" role="status">{message}</p>}
      </section>
    </div>}
    {tab==='sources' && <div role="tabpanel" id="cap-panel-sources" aria-labelledby="cap-tab-sources">
      <div className="capability-section-heading"><Settings2 size={19}/><div><h4>服务连接</h4><p>本地服务检查可达性；模型配置状态不代表已经验证权限、额度或成片质量。</p></div><button className="icon-button" aria-label="刷新能力状态" disabled={healthLoading} onClick={() => {setHealthLoading(true);setHealthError('');setRefresh(value=>value+1);}}><RotateCcw size={16} className={healthLoading?'spin':''}/></button></div>
      {healthError && <p className="capability-error" role="alert">{healthError}</p>}
      <div className="capability-services">{([{id:'recognition',name:'CPU 户型识别'}, {id:'house',name:'House 墙线识别'}, {id:'roomsmith',name:'Roomsmith 草图'}, {id:'newera',name:'New Era 光追'}, {id:'design',name:'AI 家具布置'}, {id:'image',name:'图片 / 全景生成'}, {id:'world',name:'MeltFlex 漫游空间'}] as const).map(item=><div key={item.id}><span>{item.name}</span><small data-state={services?.[item.id] || 'missing'}>{healthLoading ? '正在检查' : services ? STATES[services[item.id]] : '状态未知'}</small></div>)}</div>
      <button className="button button-light" onClick={()=>onAction('settings')}><Settings2 size={14}/>打开服务设置</button>
      <h4 className="capability-source-heading">已接入能力与参考项目</h4><p className="capability-help">只启用当前需要的编辑器和查看器。参考仓库、Codex 技能与在线服务分别管理，不会在页面加载时一起运行。</p>
      <div className="capability-sources">{DESIGN_SOURCES.map(item=><details key={item.repo}><summary><span><strong>{item.name}</strong><small>{item.use}</small></span><em>{item.license}</em></summary><p>{item.boundary}</p><div>{item.action && <button className="text-button" onClick={()=>onAction(item.action!)} disabled={busy}>打开对应功能 <ArrowRight size={12}/></button>}<a href={`https://github.com/${item.repo}`} target="_blank" rel="noreferrer">开源项目 <ExternalLink size={12}/></a></div></details>)}</div>
      <p className="capability-help">代码许可不自动覆盖第三方家具、贴图或托管服务。其余与装修无关的技能不加入产品流程。</p>
    </div>}
  </div>;
}
