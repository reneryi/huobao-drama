/**
 * 智谱 GLM-TTS 语音合成 Adapter
 * API: POST /paas/v4/audio/speech
 * 响应: audio/wav 二进制
 */
import type { TTSProviderAdapter, ProviderRequest, AIConfig } from './types'
import { joinProviderUrl } from './url'

export class ZhipuTTSAdapter implements TTSProviderAdapter {
  provider = 'zhipu'

  buildGenerateRequest(config: AIConfig, params: any): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/paas/v4', '/audio/speech'),
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        model: params.model || config.model || 'glm-tts',
        input: String(params.text || '').slice(0, 1024),
        voice: params.voice || 'tongtong',
        response_format: 'wav',
        stream: false,
        speed: params.speed ?? 1,
        volume: 1,
        watermark_enabled: false,
      },
    }
  }

  parseResponse(): any {
    throw new Error('Zhipu GLM-TTS returns binary audio; parseResponse should not be called')
  }
}
