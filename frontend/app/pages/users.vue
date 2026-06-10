<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">用户管理</h1>
        <p class="page-desc">创建账号、分配全局角色、停用离职或无效账号</p>
      </div>
      <button class="btn btn-primary" @click="dialog = true">新增用户</button>
    </div>

    <div class="user-list">
      <div v-for="u in users" :key="u.id" class="card user-row">
        <div class="user-main">
          <div class="user-name">{{ u.display_name || u.username }}</div>
          <div class="user-meta mono">{{ u.username }} · {{ roleLabel(u.global_role) }}</div>
        </div>
        <span :class="['tag', u.status === 'active' ? 'tag-success' : 'tag-error']">{{ u.status === 'active' ? '启用' : '停用' }}</span>
        <button class="btn btn-ghost btn-sm" @click="toggleStatus(u)">{{ u.status === 'active' ? '停用' : '启用' }}</button>
        <button class="btn btn-ghost btn-sm" @click="resetPassword(u)">重置密码</button>
      </div>
    </div>

    <div v-if="dialog" class="overlay" @click.self="dialog = false">
      <form class="modal card" @submit.prevent="createUser">
        <h2 class="modal-title">新增用户</h2>
        <label class="field"><span class="field-label">用户名</span><input v-model="form.username" class="input" required /></label>
        <label class="field"><span class="field-label">显示名称</span><input v-model="form.display_name" class="input" /></label>
        <label class="field"><span class="field-label">密码</span><input v-model="form.password" class="input" type="password" required /></label>
        <label class="field"><span class="field-label">全局角色</span>
          <select v-model="form.global_role" class="input">
            <option value="user">普通用户</option>
            <option value="operator">技术运营</option>
            <option value="admin">管理员</option>
          </select>
        </label>
        <div class="modal-actions">
          <button type="button" class="btn" @click="dialog = false">取消</button>
          <button type="submit" class="btn btn-primary">创建</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { usersAPI } from '~/composables/useApi'

const users = ref([])
const dialog = ref(false)
const form = reactive({ username: '', display_name: '', password: '123456', global_role: 'user' })

function roleLabel(role) {
  return ({ admin: '管理员', operator: '技术运营', user: '普通用户' })[role] || role
}

async function loadUsers() {
  try { users.value = await usersAPI.list() }
  catch (e) { toast.error(e.message) }
}

async function createUser() {
  try {
    await usersAPI.create(form)
    dialog.value = false
    Object.assign(form, { username: '', display_name: '', password: '123456', global_role: 'user' })
    toast.success('用户已创建')
    await loadUsers()
  } catch (e) { toast.error(e.message) }
}

async function toggleStatus(u) {
  try {
    await usersAPI.update(u.id, { status: u.status === 'active' ? 'disabled' : 'active' })
    await loadUsers()
  } catch (e) { toast.error(e.message) }
}

async function resetPassword(u) {
  const pwd = prompt(`输入 ${u.username} 的新密码`, '123456')
  if (!pwd) return
  try { await usersAPI.updatePassword(u.id, pwd); toast.success('密码已更新') }
  catch (e) { toast.error(e.message) }
}

onMounted(loadUsers)
</script>

<style scoped>
.page { height: 100%; overflow-y: auto; padding: 28px 48px 40px; }
.page-head { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 24px; }
.page-title { font-size: 26px; }
.page-desc { font-size: 13px; color: var(--text-3); }
.user-list { display: flex; flex-direction: column; gap: 10px; max-width: 820px; }
.user-row { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
.user-main { flex: 1; min-width: 0; }
.user-name { font-size: 14px; font-weight: 700; }
.user-meta { font-size: 12px; color: var(--text-3); }
.modal { width: min(440px, calc(100vw - 40px)); padding: 24px; display: flex; flex-direction: column; gap: 12px; }
.modal-title { font-size: 18px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 12px; font-weight: 600; color: var(--text-1); }
</style>
