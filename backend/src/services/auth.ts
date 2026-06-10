import crypto from 'crypto'
import { eq, and, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'

export const SESSION_COOKIE = 'huobao_session'
export const SESSION_DAYS = 7

export type GlobalRole = 'admin' | 'operator' | 'user'
export type ProjectRole = 'owner' | 'producer' | 'editor' | 'viewer'

export type CurrentUser = {
  id: number
  username: string
  displayName: string | null
  email: string | null
  globalRole: GlobalRole
  status: string
}

function scrypt(password: string, salt: string) {
  return crypto.scryptSync(password, salt, 64).toString('hex')
}

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex')
  return { salt, hash: scrypt(password, salt) }
}

export function verifyPassword(password: string, salt: string, hash: string) {
  const input = Buffer.from(scrypt(password, salt), 'hex')
  const expected = Buffer.from(hash, 'hex')
  return input.length === expected.length && crypto.timingSafeEqual(input, expected)
}

export function generateSessionToken() {
  return crypto.randomBytes(32).toString('base64url')
}

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function toCurrentUser(user: typeof schema.users.$inferSelect): CurrentUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    globalRole: user.globalRole as GlobalRole,
    status: user.status,
  }
}

export function createUser(input: {
  username: string
  password: string
  displayName?: string | null
  email?: string | null
  globalRole?: GlobalRole
}) {
  const ts = now()
  const { hash, salt } = hashPassword(input.password)
  const res = db.insert(schema.users).values({
    username: input.username,
    displayName: input.displayName || input.username,
    email: input.email || null,
    passwordHash: hash,
    passwordSalt: salt,
    globalRole: input.globalRole || 'user',
    status: 'active',
    createdAt: ts,
    updatedAt: ts,
  }).run()
  const [user] = db.select().from(schema.users).where(eq(schema.users.id, Number(res.lastInsertRowid))).all()
  return user
}

export function ensureDefaultAdmin() {
  const count = db.select().from(schema.users).all().length
  if (count > 0) return null
  return createUser({
    username: process.env.DEFAULT_ADMIN_USERNAME || 'admin',
    password: process.env.DEFAULT_ADMIN_PASSWORD || 'admin123',
    displayName: '系统管理员',
    globalRole: 'admin',
  })
}

export function authenticate(username: string, password: string) {
  const [user] = db.select().from(schema.users).where(eq(schema.users.username, username)).all()
  if (!user || user.deletedAt || user.status !== 'active') return null
  if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) return null
  db.update(schema.users).set({ lastLoginAt: now(), updatedAt: now() }).where(eq(schema.users.id, user.id)).run()
  return user
}

export function createSession(userId: number, meta?: { userAgent?: string | null; ip?: string | null }) {
  const token = generateSessionToken()
  const ts = now()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  db.insert(schema.userSessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    createdAt: ts,
    lastUsedAt: ts,
    userAgent: meta?.userAgent || null,
    ip: meta?.ip || null,
  }).run()
  return { token, expiresAt }
}

export function verifySession(token?: string | null) {
  if (!token) return null
  const tokenHash = hashToken(token)
  const [session] = db.select().from(schema.userSessions)
    .where(and(eq(schema.userSessions.tokenHash, tokenHash), isNull(schema.userSessions.revokedAt)))
    .all()
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null

  const [user] = db.select().from(schema.users).where(eq(schema.users.id, session.userId)).all()
  if (!user || user.deletedAt || user.status !== 'active') return null

  db.update(schema.userSessions).set({ lastUsedAt: now() }).where(eq(schema.userSessions.id, session.id)).run()
  return { session, user }
}

export function revokeSession(token?: string | null) {
  if (!token) return
  db.update(schema.userSessions)
    .set({ revokedAt: now() })
    .where(eq(schema.userSessions.tokenHash, hashToken(token)))
    .run()
}

export function hasGlobalRole(user: CurrentUser, roles: GlobalRole[]) {
  return roles.includes(user.globalRole)
}

export function isPrivileged(user: CurrentUser) {
  return hasGlobalRole(user, ['admin', 'operator'])
}

export function findMembership(userId: number, dramaId: number) {
  const [member] = db.select().from(schema.dramaMembers)
    .where(and(eq(schema.dramaMembers.userId, userId), eq(schema.dramaMembers.dramaId, dramaId)))
    .all()
  return member || null
}

export function canAccessDrama(user: CurrentUser, dramaId: number, roles?: ProjectRole[]) {
  if (isPrivileged(user)) return true
  const member = findMembership(user.id, dramaId)
  if (!member) return false
  return roles ? roles.includes(member.projectRole as ProjectRole) : true
}

export function attachDramaOwner(dramaId: number, userId: number) {
  const ts = now()
  const existing = findMembership(userId, dramaId)
  if (existing) return existing
  db.insert(schema.dramaMembers).values({
    dramaId,
    userId,
    projectRole: 'owner',
    createdBy: userId,
    createdAt: ts,
    updatedAt: ts,
  }).run()
  return findMembership(userId, dramaId)
}
