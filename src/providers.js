'use strict';
// Provider registry (SPEC §2: roles depend on capabilities, not brands).
// One OpenAI-compatible adapter covers every preset marked
// api: 'openai-compatible' — change base_url + model + key env and go.
// Presets are starting points: verify the base_url against the provider's
// current official docs before relying on it. Families are recorded here by
// the Host (SPEC §7) — models never self-declare their family.

const PROVIDERS = [
  // — overseas —
  { id: 'openai',    name: 'OpenAI (GPT)',      family: 'openai',    region: 'global', api: 'openai-compatible', base_url: 'https://api.openai.com/v1',                          key_env: 'OPENAI_API_KEY',    capabilities: ['generation', 'coding', 'file_input'] },
  { id: 'xai',       name: 'xAI (Grok)',        family: 'xai',       region: 'global', api: 'openai-compatible', base_url: 'https://api.x.ai/v1',                                key_env: 'XAI_API_KEY',       capabilities: ['generation', 'file_input'] },
  { id: 'gemini',    name: 'Google (Gemini)',   family: 'google',    region: 'global', api: 'openai-compatible', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/', key_env: 'GEMINI_API_KEY',  capabilities: ['generation', 'coding', 'file_input'] },
  { id: 'anthropic', name: 'Anthropic (Claude)', family: 'anthropic', region: 'global', api: 'anthropic-native', base_url: 'https://api.anthropic.com',                       key_env: 'ANTHROPIC_API_KEY', capabilities: ['generation', 'coding', 'file_input'], note: 'native API shape differs; use its own adapter or an aggregator preset below' },
  { id: 'openrouter', name: 'OpenRouter (aggregator)', family: 'multi', region: 'global', api: 'openai-compatible', base_url: 'https://openrouter.ai/api/v1',                 key_env: 'OPENROUTER_API_KEY', capabilities: ['generation', 'coding', 'file_input'], note: 'family = the underlying model you route to; record that model, not the aggregator' },
  // — domestic (China) —
  { id: 'deepseek',  name: 'DeepSeek',          family: 'deepseek',  region: 'cn', api: 'openai-compatible', base_url: 'https://api.deepseek.com/v1',                             key_env: 'DEEPSEEK_API_KEY',  capabilities: ['generation', 'coding'] },
  { id: 'moonshot',  name: 'Kimi (Moonshot)',   family: 'moonshot',  region: 'cn', api: 'openai-compatible', base_url: 'https://api.moonshot.cn/v1',                              key_env: 'MOONSHOT_API_KEY',  capabilities: ['generation', 'file_input'] },
  { id: 'qwen',      name: 'Qwen (DashScope)',  family: 'alibaba',   region: 'cn', api: 'openai-compatible', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',         key_env: 'DASHSCOPE_API_KEY', capabilities: ['generation', 'coding', 'file_input'] },
  { id: 'zhipu',     name: 'GLM (Zhipu)',       family: 'zhipu',     region: 'cn', api: 'openai-compatible', base_url: 'https://open.bigmodel.cn/api/paas/v4',                      key_env: 'ZHIPU_API_KEY',     capabilities: ['generation', 'coding'] },
  { id: 'doubao',    name: 'Doubao (Volcengine Ark)', family: 'bytedance', region: 'cn', api: 'openai-compatible', base_url: 'https://ark.cn-beijing.volces.com/api/v3',           key_env: 'ARK_API_KEY',       capabilities: ['generation', 'file_input'], note: 'model field is an endpoint id (ep-…) on Ark' },
  { id: 'minimax',   name: 'MiniMax',           family: 'minimax',   region: 'cn', api: 'openai-compatible', base_url: 'https://api.minimax.chat/v1',                             key_env: 'MINIMAX_API_KEY',   capabilities: ['generation'] },
  { id: 'siliconflow', name: 'SiliconFlow (aggregator)', family: 'multi', region: 'cn', api: 'openai-compatible', base_url: 'https://api.siliconflow.cn/v1',                  key_env: 'SILICONFLOW_API_KEY', capabilities: ['generation', 'coding'], note: 'family = the underlying model you route to' },
  { id: 'hunyuan',   name: 'Hunyuan (Tencent)', family: 'tencent',   region: 'cn', api: 'openai-compatible', base_url: 'https://api.hunyuan.cloud.tencent.com/v1',                key_env: 'HUNYUAN_API_KEY',   capabilities: ['generation'] },
  // — local —
  { id: 'ollama',    name: 'Ollama (local)',    family: 'local',     region: 'any', api: 'openai-compatible', base_url: 'http://localhost:11434/v1',                              key_env: null,                capabilities: ['generation', 'coding'], note: 'zero cash cost; quota type local_compute' },
  // — web / manual ferry (no API needed; Host generates a paste package) —
  { id: 'chatgpt-web', name: 'ChatGPT (web)',   family: 'openai',    region: 'global', api: 'web-manual', base_url: null, key_env: null, capabilities: ['generation', 'file_input'] },
  { id: 'kimi-web',    name: 'Kimi (web)',      family: 'moonshot',  region: 'cn', api: 'web-manual', base_url: null, key_env: null, capabilities: ['generation', 'file_input'] },
  { id: 'doubao-web',  name: 'Doubao (web)',    family: 'bytedance', region: 'cn', api: 'web-manual', base_url: null, key_env: null, capabilities: ['generation'] },
  { id: 'yuanbao-web', name: 'Yuanbao (web)',   family: 'tencent',   region: 'cn', api: 'web-manual', base_url: null, key_env: null, capabilities: ['generation'] },
  { id: 'grok-web',    name: 'Grok (web)',      family: 'xai',       region: 'global', api: 'web-manual', base_url: null, key_env: null, capabilities: ['generation'] },
];

function getProvider(id) { return PROVIDERS.find((p) => p.id === id) || null; }
function providersFor(capability) { return PROVIDERS.filter((p) => p.capabilities.includes(capability)); }

module.exports = { PROVIDERS, getProvider, providersFor };
