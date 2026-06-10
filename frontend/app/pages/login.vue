<template>
  <div class="login-page">
    <form class="login-panel card" @submit.prevent="submit">
      <div class="login-brand">
        <img :src="brandLogo" alt="火宝短剧" class="login-logo" />
        <div>
          <h1>火宝短剧</h1>
          <p>登录后继续制作</p>
        </div>
      </div>
      <label class="field">
        <span class="field-label">用户名</span>
        <input v-model="username" class="input" autocomplete="username" autofocus />
      </label>
      <label class="field">
        <span class="field-label">密码</span>
        <input v-model="password" class="input" type="password" autocomplete="current-password" />
      </label>
      <button class="btn btn-primary" type="submit" :disabled="loading">
        {{ loading ? '登录中...' : '登录' }}
      </button>
      <div class="login-hint mono">默认管理员：admin / admin123</div>
    </form>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import brandLogo from '~/assets/huobao-logo.png'

definePageMeta({ layout: false })

const route = useRoute()
const { login } = useAuth()
const username = ref('admin')
const password = ref('admin123')
const loading = ref(false)

async function submit() {
  if (!username.value || !password.value) return toast.warning('请输入用户名和密码')
  loading.value = true
  try {
    await login(username.value, password.value)
    await navigateTo(String(route.query.redirect || '/'))
  } catch (e) {
    toast.error(e.message || '登录失败')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: linear-gradient(180deg, #f8fbff 0%, #eef3f9 100%);
}
.login-panel {
  width: min(420px, 100%);
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.login-brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 6px;
}
.login-logo {
  width: 42px;
  height: 42px;
  object-fit: contain;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-0);
  padding: 8px;
}
.login-brand h1 { font-size: 22px; }
.login-brand p { font-size: 13px; color: var(--text-3); }
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 12px; font-weight: 600; color: var(--text-1); }
.login-hint { font-size: 12px; color: var(--text-3); text-align: center; }
</style>
