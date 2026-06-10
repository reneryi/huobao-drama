import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { db, schema } from '../db/index.js'
import { authenticate, createSession, ensureDefaultAdmin, revokeSession, SESSION_COOKIE, SESSION_DAYS, toCurrentUser, verifySession } from '../services/auth.js'
import { badRequest, success, unauthorized } from '../utils/response.js'

const app = new Hono()

function cookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: expires ? SESSION_DAYS * 24 * 60 * 60 : 0,
    expires,
  }
}

app.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  if (!username || !password) return badRequest(c, '用户名和密码不能为空')

  const user = authenticate(username, password)
  if (!user) return unauthorized(c, '用户名或密码错误')

  const session = createSession(user.id, {
    userAgent: c.req.header('user-agent'),
    ip: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
  })
  setCookie(c, SESSION_COOKIE, session.token, cookieOptions(new Date(session.expiresAt)))
  return success(c, toCurrentUser(user))
})

app.post('/logout', async (c) => {
  revokeSession(getCookie(c, SESSION_COOKIE))
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return success(c)
})

app.get('/me', async (c) => {
  const verified = verifySession(getCookie(c, SESSION_COOKIE))
  if (!verified) return unauthorized(c, '请先登录')
  return success(c, toCurrentUser(verified.user))
})

app.post('/bootstrap', async (c) => {
  const count = db.select().from(schema.users).all().length
  if (count > 0) return badRequest(c, '系统已经初始化')
  const admin = ensureDefaultAdmin()
  return success(c, admin ? toCurrentUser(admin) : null)
})

export default app
