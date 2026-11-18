import { aiConfiguration, setting } from '../../../lib/server-env';
import { json } from '../../../lib/ai-server';
export function GET(){const c=aiConfiguration();return json({imageConfigured:!!c.imageKey,visionConfigured:!!c.visionKey,cpuConfigured:!!setting('RECOGNITION_SERVICE_URL'),imageModel:c.imageModel,visionModel:c.visionModel,imageProtocol:c.imageProtocol,imageProvider:c.imageBase.includes('api.openai.com')?'OpenAI':c.imageProtocol==='conflux_async'?'Conflux · OpenAI GPT Image':'兼容接口',message:c.imageKey?'已配置真实生图服务':'生图接口待配置；示例图由 ImageGen 真实生成。'});}
