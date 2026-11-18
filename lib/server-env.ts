import { AsyncLocalStorage } from 'node:async_hooks';
const context = new AsyncLocalStorage<Record<string, unknown>>();
export function runWithAppEnv<T>(env: Record<string, unknown>, run:()=>T): T { return context.run(env,run); }
export function setting(name: string): string { const value=context.getStore()?.[name] ?? process.env[name]; return typeof value==='string'?value:''; }
export function aiConfiguration() {
  return {
    imageKey:setting('IMAGE_API_KEY')||setting('OPENAI_API_KEY'),
    imageBase:(setting('IMAGE_BASE_URL')||'https://api.openai.com/v1').replace(/\/$/,''),
    imageModel:setting('IMAGE_MODEL')||'gpt-image-2',
    imageProtocol:setting('IMAGE_PROTOCOL')==='conflux_async'?'conflux_async':'openai',
    visionKey:setting('CONFLUX_API_KEY')||setting('OPENAI_API_KEY'),
    visionBase:(setting('CONFLUX_BASE_URL')||'https://api.openai.com/v1').replace(/\/$/,''),
    visionModel:setting('VISION_MODEL')||'gpt-4.1',
  };
}
