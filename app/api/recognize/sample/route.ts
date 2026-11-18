import { authorize,errorResponse,json } from '../../../../lib/ai-server';
import { recognizeSample } from '../../../../lib/recognition-server';
export async function GET(request:Request){let release:(()=>void)|undefined;try{release=authorize(request);return json(await recognizeSample());}catch(error){return errorResponse(error);}finally{release?.();}}
