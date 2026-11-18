import { authorize,errorResponse,json,readBody } from '../../../lib/ai-server';
import { recognizeImage } from '../../../lib/recognition-server';
export async function POST(request:Request){let release:(()=>void)|undefined;try{release=authorize(request);return json(await recognizeImage(await readBody(request)));}catch(error){return errorResponse(error);}finally{release?.();}}
