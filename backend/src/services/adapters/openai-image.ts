/**
 * OpenAI DALL-E 图片生成 Adapter
 * 端点: /v1/images/generations (注意 /v1 前缀)
 * 响应格式: { data: [{ url: "..." }] } 或 { data: [{ b64_json: "..." }] }
 */
import type {
  ImageProviderAdapter,
  ProviderRequest,
  AIConfig,
  ImageGenerationRecord,
  ImageGenResponse,
  ImagePollResponse,
} from './types'
import { joinProviderUrl } from './url'

export class OpenAIImageAdapter implements ImageProviderAdapter {
  provider = 'openai'

  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest {
    const model = record.model || config.model || 'dall-e-3'
    const isGptImage = model.toLowerCase().startsWith('gpt-image')
    // OpenAI 图片模型对尺寸枚举比较严格；项目里常传 1920x1080，这里映射为 gpt-image 可接受的横图尺寸
    const size = this.normalizeSize(record.size, isGptImage)

    const body: any = {
      model,
      prompt: record.prompt,
      size,
      n: 1,
    }

    // gpt-image 系列通常默认返回 b64_json，且部分兼容服务不接受 response_format=url
    if (!isGptImage) body.response_format = 'url'

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/images/generations'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): ImageGenResponse {
    // OpenAI DALL-E 3 目前是同步返回，但规范上也有异步 task 模式
    if (result.task_id || result.id) {
      return { isAsync: true, taskId: result.task_id || result.id }
    }
    const imageUrl = result.data?.[0]?.url || result.url
    if (imageUrl) {
      return { isAsync: false, imageUrl }
    }
    // b64_json 模式
    const b64 = result.data?.[0]?.b64_json
    if (b64) {
      // 对于 base64，返回特殊标记，实际处理在 extractImageBase64
      return { isAsync: false, imageUrl: undefined }
    }
    throw new Error('No image URL in response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', `/images/task/${taskId}`),
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): ImagePollResponse {
    if (result.status === 'completed') {
      return {
        status: 'completed',
        imageUrl: result.image_url || result.data?.[0]?.url || null,
      }
    }
    if (result.status === 'failed') {
      return { status: 'failed', error: result.error?.message || 'Generation failed' }
    }
    return { status: result.status || 'processing' }
  }

  extractImageUrl(result: any): string | null {
    return result.data?.[0]?.url || result.image_url || null
  }

  extractImageBase64(result: any): { data: string; mimeType: string } | null {
    const b64 = result.data?.[0]?.b64_json
    if (b64) {
      return { data: b64, mimeType: 'image/png' }
    }
    return null
  }

  private normalizeSize(size?: string | null, isGptImage = false): string {
    if (!isGptImage) return size || '1024x1024'
    if (size === '1920x1080' || size === '1536x864' || size === '16:9') return '1536x1024'
    if (size === '1080x1920' || size === '864x1536' || size === '9:16') return '1024x1536'
    if (size === '1024x1024' || size === '1024x1536' || size === '1536x1024') return size
    return '1024x1024'
  }
}
