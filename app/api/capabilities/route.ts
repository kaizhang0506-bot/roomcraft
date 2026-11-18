import { errorResponse, json, requestActor } from '../../../lib/ai-server';
import { aiConfiguration, setting } from '../../../lib/server-env';
import type { CapabilityHealth, ServiceState } from '../../../lib/design-capabilities';

async function healthProbe(base: string): Promise<{state: ServiceState; data?: Record<string, unknown>}> {
  if (!base) return {state: 'missing'};
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/health`, {signal: AbortSignal.timeout(6000), cache: 'no-store'});
    if (!response.ok) return {state: 'unavailable'};
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {state: 'unavailable'};
    return {state: 'ready', data: data as Record<string, unknown>};
  } catch { return {state: 'unavailable'}; }
}

export async function GET(request: Request) {
  try {
    requestActor(request);
    const config = aiConfiguration();
    const [recognition, newera] = await Promise.all([
      healthProbe(setting('RECOGNITION_SERVICE_URL')),
      healthProbe(setting('NEWERA_RENDER_SERVICE_URL')),
    ]);
    if (recognition.state === 'ready' && (recognition.data?.status !== 'ok' || recognition.data?.provider !== 'cpu-geometric')) recognition.state = 'unavailable';
    if (newera.state === 'ready' && (newera.data?.ok !== true || newera.data?.renderer !== 'newera-render-photo' || newera.data?.installed !== true)) newera.state = 'unavailable';
    const dependency = (key: string): ServiceState => recognition.state !== 'ready' ? recognition.state : recognition.data?.[key] === true ? 'ready' : recognition.data?.[key] === false ? 'unavailable' : 'configured';
    const services: CapabilityHealth = {
      recognition: recognition.state, house: dependency('houseAvailable'), roomsmith: dependency('roomsmithAvailable'), newera: newera.state,
      image: config.imageKey ? 'configured' : 'missing', design: config.visionKey ? 'configured' : 'missing', world: setting('MELTFLEX_API_KEY') ? 'configured' : 'missing',
    };
    return json({ services });
  } catch (error) { return errorResponse(error); }
}
