import { analyzeFloorplan, authorize, errorResponse, json, readBody } from '../../../lib/ai-server';
export async function POST(request:Request){let release:(()=>void)|undefined;try{release=authorize(request);return json(await analyzeFloorplan(await readBody(request)));}catch(e){return errorResponse(e);}finally{release?.();}}
