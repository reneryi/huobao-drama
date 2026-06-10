import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { forbidden, notFound, unauthorized } from '../utils/response.js'
import { canAccessDrama, SESSION_COOKIE, toCurrentUser, verifySession, type CurrentUser, type GlobalRole, type ProjectRole } from '../services/auth.js'

export type AuthContext = {
  Variables: {
    user: CurrentUser
  }
}

export function getCurrentUser(c: Context) {
  return c.get('user' as never) as CurrentUser | undefined
}

export async function requireAuth(c: Context, next: Next) {
  const token = getCookie(c, SESSION_COOKIE)
  const verified = verifySession(token)
  if (!verified) return unauthorized(c, '请先登录')
  c.set('user' as never, toCurrentUser(verified.user) as never)
  return next()
}

export function requireGlobalRole(...roles: GlobalRole[]) {
  return async (c: Context, next: Next) => {
    const user = getCurrentUser(c)
    if (!user) return unauthorized(c, '请先登录')
    if (!roles.includes(user.globalRole)) return forbidden(c, '无权访问该功能')
    return next()
  }
}

export function assertGlobalRole(c: Context, roles: GlobalRole[]) {
  const user = getCurrentUser(c)
  return !!user && roles.includes(user.globalRole)
}

export function assertDramaAccess(c: Context, dramaId: number, roles?: ProjectRole[]) {
  const user = getCurrentUser(c)
  return !!user && canAccessDrama(user, dramaId, roles)
}

export function forbidIfNoDramaAccess(c: Context, dramaId: number, roles?: ProjectRole[]) {
  if (!assertDramaAccess(c, dramaId, roles)) return forbidden(c, '无权访问该项目')
  return null
}

export function getDramaIdByEpisodeId(episodeId: number) {
  const [episode] = db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId)).all()
  return episode?.dramaId || null
}

export function getDramaIdByStoryboardId(storyboardId: number) {
  const [storyboard] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboardId)).all()
  if (!storyboard) return null
  return getDramaIdByEpisodeId(storyboard.episodeId)
}

export function getDramaIdByCharacterId(characterId: number) {
  const [character] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
  return character?.dramaId || null
}

export function getDramaIdBySceneId(sceneId: number) {
  const [scene] = db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId)).all()
  return scene?.dramaId || null
}

export function requireExistingDramaAccess(c: Context, dramaId: number | null, roles?: ProjectRole[]) {
  if (!dramaId) return notFound(c, '项目不存在')
  return forbidIfNoDramaAccess(c, dramaId, roles)
}
