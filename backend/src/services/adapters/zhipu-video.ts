/**
 * 智谱 CogVideoX 视频生成 Adapter
 * 端点: /paas/v4/videos/generations
 * 轮询: /paas/v4/async-result/{id}
 */
import type {
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
} from './types'
import { joinProviderUrl } from './url'

export class ZhipuVideoAdapter implements VideoProviderAdapter {
  provider = 'zhipu'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    const imageUrl = this.resolveImageUrl(record)
    const body: any = {
      model: record.model || config.model || 'cogvideox-3',
      prompt: (record.prompt || '让画面动起来').slice(0, 512),
      quality: 'quality',
      with_audio: true,
      size: this.resolveSize(record.aspectRatio),
      fps: 30,
      duration: this.normalizeDuration(record.duration),
      watermark_enabled: false,
    }

    if (imageUrl) body.image_url = imageUrl

    return {
      url: joinProviderUrl(config.baseUrl, '/paas/v4', '/videos/generations'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const taskId = result.id || result.task_id || result.data?.id
    if (taskId) return { isAsync: true, taskId }

    const videoUrl = this.extractVideoUrl(result)
    if (videoUrl) return { isAsync: false, videoUrl }

    throw new Error('No task id or video URL in Zhipu response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/paas/v4', `/async-result/${taskId}`),
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const status = result.task_status || result.status || result.data?.task_status
    if (status === 'SUCCESS' || status === 'succeeded' || status === 'completed') {
      return { status: 'completed', videoUrl: this.extractVideoUrl(result) || undefined }
    }
    if (status === 'FAIL' || status === 'FAILED' || status === 'failed' || status === 'error') {
      return { status: 'failed', error: result.error?.message || result.error || 'Zhipu video generation failed' }
    }
    return { status: 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    return result.video_result?.[0]?.url
      || result.data?.video_result?.[0]?.url
      || result.video_url
      || result.data?.video_url
      || null
  }

  private resolveImageUrl(record: VideoGenerationRecord): string | string[] | null {
    if (record.referenceMode === 'single' && record.imageUrl) return record.imageUrl
    if (record.referenceMode === 'first_last') {
      const frames = [record.firstFrameUrl, record.lastFrameUrl].filter(Boolean) as string[]
      return frames.length ? frames.slice(0, 2) : null
    }
    if (record.referenceMode === 'multiple' && record.referenceImageUrls) {
      try {
        const refs = JSON.parse(record.referenceImageUrls)
        if (Array.isArray(refs) && refs.length) return refs.slice(0, 2)
      } catch {}
    }
    return null
  }

  private resolveSize(aspectRatio?: string | null): string {
    if (aspectRatio === '9:16') return '1080x1920'
    if (aspectRatio === '1:1') return '1024x1024'
    return '1920x1080'
  }

  private normalizeDuration(duration?: number | null): number {
    const parsed = Math.round(Number(duration || 5))
    return parsed >= 8 ? 10 : 5
  }
}
