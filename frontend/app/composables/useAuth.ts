import { authAPI } from '~/composables/useApi'

export function useAuth() {
  const user = useState<any | null>('auth:user', () => null)
  const loaded = useState<boolean>('auth:loaded', () => false)

  const isLoggedIn = computed(() => !!user.value)
  const isAdmin = computed(() => user.value?.globalRole === 'admin' || user.value?.global_role === 'admin')
  const isOperator = computed(() => ['admin', 'operator'].includes(user.value?.globalRole || user.value?.global_role))

  async function fetchMe() {
    try {
      user.value = await authAPI.me()
    } catch {
      user.value = null
    } finally {
      loaded.value = true
    }
    return user.value
  }

  async function login(username: string, password: string) {
    user.value = await authAPI.login({ username, password })
    loaded.value = true
    return user.value
  }

  async function logout() {
    try { await authAPI.logout() } finally {
      user.value = null
      loaded.value = true
      await navigateTo('/login')
    }
  }

  function hasGlobalRole(...roles: string[]) {
    const role = user.value?.globalRole || user.value?.global_role
    return roles.includes(role)
  }

  return { user, loaded, isLoggedIn, isAdmin, isOperator, fetchMe, login, logout, hasGlobalRole }
}
