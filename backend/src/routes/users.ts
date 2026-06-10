import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { createUser, hashPassword, type GlobalRole } from '../services/auth.js'
import { requireGlobalRole } from '../middleware/auth.js'
import { badRequest, forbidden, notFound, now, success } from '../utils/response.js'

const app = new Hono()

const GLOBAL_ROLES: GlobalRole[] = ['admin', 'operator', 'user']

function publicUser(user: typeof schema.users.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.displayName,
    email: user.email,
    global_role: user.globalRole,
    status: user.status,
    last_login_at: user.lastLoginAt,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  }
}

app.get('/', async (c) => {
  const rows = db.select().from(schema.users).all()
    .filter(user => !user.deletedAt)
    .map(publicUser)
  return success(c, rows)
})

app.use('*', requireGlobalRole('admin'))

app.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  const globalRole = String(body.global_role || 'user') as GlobalRole

  if (!username || !password) return badRequest(c, '用户名和密码不能为空')
  if (!GLOBAL_ROLES.includes(globalRole)) return badRequest(c, '无效的全局角色')
  if (password.length < 6) return badRequest(c, '密码至少 6 位')

  const exists = db.select().from(schema.users).where(eq(schema.users.username, username)).all()[0]
  if (exists) return badRequest(c, '用户名已存在')

  const user = createUser({
    username,
    password,
    displayName: body.display_name || username,
    email: body.email || null,
    globalRole,
  })
  return success(c, publicUser(user))
})

app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const [user] = db.select().from(schema.users).where(eq(schema.users.id, id)).all()
  if (!user || user.deletedAt) return notFound(c, '用户不存在')

  const updates: Record<string, any> = { updatedAt: now() }
  if ('display_name' in body) updates.displayName = body.display_name
  if ('email' in body) updates.email = body.email
  if ('status' in body) updates.status = body.status === 'disabled' ? 'disabled' : 'active'
  if ('global_role' in body) {
    if (!GLOBAL_ROLES.includes(body.global_role)) return badRequest(c, '无效的全局角色')
    updates.globalRole = body.global_role
  }

  db.update(schema.users).set(updates).where(eq(schema.users.id, id)).run()
  const [updated] = db.select().from(schema.users).where(eq(schema.users.id, id)).all()
  return success(c, publicUser(updated))
})

app.put('/:id/password', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const password = String(body.password || '')
  if (password.length < 6) return badRequest(c, '密码至少 6 位')

  const [user] = db.select().from(schema.users).where(eq(schema.users.id, id)).all()
  if (!user || user.deletedAt) return notFound(c, '用户不存在')
  const { hash, salt } = hashPassword(password)
  db.update(schema.users).set({ passwordHash: hash, passwordSalt: salt, updatedAt: now() }).where(eq(schema.users.id, id)).run()
  return success(c)
})

app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [user] = db.select().from(schema.users).where(eq(schema.users.id, id)).all()
  if (!user || user.deletedAt) return notFound(c, '用户不存在')
  if (user.globalRole === 'admin') {
    const admins = db.select().from(schema.users).all().filter(row => row.globalRole === 'admin' && row.status === 'active' && !row.deletedAt)
    if (admins.length <= 1) return forbidden(c, '至少保留一个可用管理员')
  }
  db.update(schema.users).set({ status: 'disabled', deletedAt: now(), updatedAt: now() }).where(eq(schema.users.id, id)).run()
  return success(c)
})

export default app
