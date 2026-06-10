import { Hono } from 'hono'
import { and, eq, isNull, desc } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, notFound, created, now } from '../utils/response.js'
import { toSnakeCase, toSnakeCaseArray } from '../utils/transform.js'
import { getCurrentUser, requireExistingDramaAccess } from '../middleware/auth.js'
import { attachDramaOwner, isPrivileged, type ProjectRole } from '../services/auth.js'

const app = new Hono()
const PROJECT_ROLES: ProjectRole[] = ['owner', 'producer', 'editor', 'viewer']

function currentUserOrThrow(c: any) {
  const user = getCurrentUser(c)
  if (!user) throw new Error('missing user')
  return user
}

function enrichMember(row: typeof schema.dramaMembers.$inferSelect) {
  const [user] = db.select().from(schema.users).where(eq(schema.users.id, row.userId)).all()
  return {
    id: row.id,
    drama_id: row.dramaId,
    user_id: row.userId,
    project_role: row.projectRole,
    username: user?.username || '',
    display_name: user?.displayName || user?.username || '',
    global_role: user?.globalRole || 'user',
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

// GET /dramas - List dramas
app.get('/', async (c) => {
  const user = currentUserOrThrow(c)
  const page = Number(c.req.query('page') || 1)
  const pageSize = Number(c.req.query('page_size') || 20)
  const status = c.req.query('status')
  const keyword = c.req.query('keyword')

  let query = db.select().from(schema.dramas).where(isNull(schema.dramas.deletedAt))

  const allRows = await query.orderBy(desc(schema.dramas.updatedAt))
  let filtered = allRows

  if (!isPrivileged(user)) {
    const memberDramaIds = new Set(db.select().from(schema.dramaMembers)
      .where(eq(schema.dramaMembers.userId, user.id)).all()
      .map(row => row.dramaId))
    filtered = filtered.filter(d => memberDramaIds.has(d.id))
  }

  if (status) filtered = filtered.filter(d => d.status === status)
  if (keyword) filtered = filtered.filter(d => d.title.includes(keyword))

  const total = filtered.length
  const items = filtered.slice((page - 1) * pageSize, page * pageSize)

  // Attach episode/character/scene counts
  const enriched = await Promise.all(items.map(async (drama) => {
    const eps = await db.select().from(schema.episodes)
      .where(eq(schema.episodes.dramaId, drama.id))
    const chars = await db.select().from(schema.characters)
      .where(eq(schema.characters.dramaId, drama.id))
    const scns = await db.select().from(schema.scenes)
      .where(eq(schema.scenes.dramaId, drama.id))
    return {
      ...toSnakeCase(drama),
      tags: drama.tags ? JSON.parse(drama.tags) : [],
      total_episodes: eps.length,
      episodes: toSnakeCaseArray(eps),
      characters: toSnakeCaseArray(chars),
      scenes: toSnakeCaseArray(scns),
    }
  }))

  return success(c, {
    items: enriched,
    pagination: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) },
  })
})

// POST /dramas - Create drama
app.post('/', async (c) => {
  const user = currentUserOrThrow(c)
  const body = await c.req.json()
  const ts = now()
  const res = db.insert(schema.dramas).values({
    title: body.title,
    description: body.description,
    genre: body.genre,
    style: body.style,
    tags: body.tags ? JSON.stringify(body.tags) : null,
    metadata: body.metadata,
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const [result] = db.select().from(schema.dramas)
    .where(eq(schema.dramas.id, Number(res.lastInsertRowid))).all()

  attachDramaOwner(result.id, user.id)

  // Create default episodes
  const totalEpisodes = body.total_episodes || 1
  for (let i = 1; i <= totalEpisodes; i++) {
    db.insert(schema.episodes).values({
      dramaId: result.id,
      episodeNumber: i,
      title: `第${i}集`,
      status: 'draft',
      createdAt: ts,
      updatedAt: ts,
    }).run()
  }

  return created(c, toSnakeCase(result))
})


// GET /dramas/stats — must be before /:id
app.get('/stats', async (c) => {
  const user = currentUserOrThrow(c)
  let all = db.select().from(schema.dramas).where(isNull(schema.dramas.deletedAt)).all()
  if (!isPrivileged(user)) {
    const memberDramaIds = new Set(db.select().from(schema.dramaMembers)
      .where(eq(schema.dramaMembers.userId, user.id)).all()
      .map(row => row.dramaId))
    all = all.filter(d => memberDramaIds.has(d.id))
  }
  const byStatus = Object.entries(
    all.reduce((acc, d) => {
      acc[d.status || 'draft'] = (acc[d.status || 'draft'] || 0) + 1
      return acc
    }, {} as Record<string, number>)
  ).map(([status, count]) => ({ status, count }))
  return success(c, { total: all.length, by_status: byStatus })
})

// GET /dramas/:id/members - List project members
app.get('/:id/members', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const blocked = requireExistingDramaAccess(c, dramaId, ['owner', 'producer'])
  if (blocked) return blocked
  const rows = db.select().from(schema.dramaMembers).where(eq(schema.dramaMembers.dramaId, dramaId)).all()
  return success(c, rows.map(enrichMember))
})

// POST /dramas/:id/members - Add project member
app.post('/:id/members', async (c) => {
  const user = currentUserOrThrow(c)
  const dramaId = Number(c.req.param('id'))
  const blocked = requireExistingDramaAccess(c, dramaId, ['owner', 'producer'])
  if (blocked) return blocked
  const body = await c.req.json()
  const userId = Number(body.user_id)
  const projectRole = String(body.project_role || 'viewer') as ProjectRole
  if (!userId) return badRequest(c, 'user_id required')
  if (!PROJECT_ROLES.includes(projectRole)) return badRequest(c, '无效的项目角色')
  const [targetUser] = db.select().from(schema.users).where(eq(schema.users.id, userId)).all()
  if (!targetUser || targetUser.deletedAt) return badRequest(c, '用户不存在')
  const [existing] = db.select().from(schema.dramaMembers)
    .where(eq(schema.dramaMembers.dramaId, dramaId)).all()
    .filter(row => row.userId === userId)
  if (existing) return badRequest(c, '该用户已在项目中')
  const ts = now()
  db.insert(schema.dramaMembers).values({
    dramaId,
    userId,
    projectRole,
    createdBy: user.id,
    createdAt: ts,
    updatedAt: ts,
  }).run()
  return success(c)
})

// PUT /dramas/:id/members/:userId - Update project role
app.put('/:id/members/:userId', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const memberUserId = Number(c.req.param('userId'))
  const blocked = requireExistingDramaAccess(c, dramaId, ['owner'])
  if (blocked) return blocked
  const body = await c.req.json()
  const projectRole = String(body.project_role || '') as ProjectRole
  if (!PROJECT_ROLES.includes(projectRole)) return badRequest(c, '无效的项目角色')
  const [member] = db.select().from(schema.dramaMembers)
    .where(and(eq(schema.dramaMembers.dramaId, dramaId), eq(schema.dramaMembers.userId, memberUserId)))
    .all()
  if (!member) return notFound(c, '成员不存在')
  db.update(schema.dramaMembers)
    .set({ projectRole, updatedAt: now() })
    .where(eq(schema.dramaMembers.id, member.id))
    .run()
  return success(c)
})

// DELETE /dramas/:id/members/:userId - Remove project member
app.delete('/:id/members/:userId', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const memberUserId = Number(c.req.param('userId'))
  const blocked = requireExistingDramaAccess(c, dramaId, ['owner'])
  if (blocked) return blocked
  const [member] = db.select().from(schema.dramaMembers)
    .where(and(eq(schema.dramaMembers.dramaId, dramaId), eq(schema.dramaMembers.userId, memberUserId)))
    .all()
  if (!member) return notFound(c, '成员不存在')
  db.delete(schema.dramaMembers)
    .where(eq(schema.dramaMembers.id, member.id))
    .run()
  return success(c)
})

// GET /dramas/:id - Get drama detail
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const blocked = requireExistingDramaAccess(c, id)
  if (blocked) return blocked
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, id))
  if (!drama) return notFound(c, '剧本不存在')

  const eps = await db.select().from(schema.episodes)
    .where(eq(schema.episodes.dramaId, id))
  const chars = await db.select().from(schema.characters)
    .where(eq(schema.characters.dramaId, id))
  const scns = await db.select().from(schema.scenes)
    .where(eq(schema.scenes.dramaId, id))
  const prps = await db.select().from(schema.props)
    .where(eq(schema.props.dramaId, id))

  return success(c, {
    ...toSnakeCase(drama),
    tags: drama.tags ? JSON.parse(drama.tags) : [],
    episodes: toSnakeCaseArray(eps),
    characters: toSnakeCaseArray(chars),
    scenes: toSnakeCaseArray(scns),
    props: toSnakeCaseArray(prps),
  })
})

// PUT /dramas/:id - Update drama
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const blocked = requireExistingDramaAccess(c, id, ['owner', 'producer'])
  if (blocked) return blocked
  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  if (body.title !== undefined) updates.title = body.title
  if (body.description !== undefined) updates.description = body.description
  if (body.genre !== undefined) updates.genre = body.genre
  if (body.style !== undefined) updates.style = body.style
  if (body.status !== undefined) updates.status = body.status
  if (body.tags !== undefined) updates.tags = JSON.stringify(body.tags)
  if (body.metadata !== undefined) updates.metadata = body.metadata
  db.update(schema.dramas).set(updates).where(eq(schema.dramas.id, id)).run()
  return success(c)
})

// DELETE /dramas/:id - Soft delete
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const blocked = requireExistingDramaAccess(c, id, ['owner'])
  if (blocked) return blocked
  await db.update(schema.dramas).set({ deletedAt: now() }).where(eq(schema.dramas.id, id))
  return success(c)
})

// PUT /dramas/:id/characters - Save characters
app.put('/:id/characters', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const blocked = requireExistingDramaAccess(c, dramaId, ['owner', 'producer', 'editor'])
  if (blocked) return blocked
  const body = await c.req.json()
  const chars = body.characters || []
  const ts = now()

  for (const char of chars) {
    if (char.id) {
      await db.update(schema.characters).set({ ...char, updatedAt: ts }).where(eq(schema.characters.id, char.id))
    } else {
      await db.insert(schema.characters).values({ ...char, dramaId, createdAt: ts, updatedAt: ts })
    }
  }
  return success(c)
})

// PUT /dramas/:id/episodes - Save episodes
app.put('/:id/episodes', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const blocked = requireExistingDramaAccess(c, dramaId, ['owner', 'producer', 'editor'])
  if (blocked) return blocked
  const body = await c.req.json()
  const episodes = body.episodes || []
  const ts = now()

  for (const ep of episodes) {
    if (ep.id) {
      await db.update(schema.episodes).set({ ...ep, updatedAt: ts }).where(eq(schema.episodes.id, ep.id))
    } else {
      await db.insert(schema.episodes).values({
        ...ep,
        dramaId,
        episodeNumber: ep.episode_number || ep.episodeNumber || 1,
        title: ep.title || '未命名',
        createdAt: ts,
        updatedAt: ts,
      })
    }
  }
  return success(c)
})

export default app
