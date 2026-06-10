export default defineNuxtRouteMiddleware(async (to) => {
  const { user, loaded, fetchMe } = useAuth()
  if (!loaded.value) await fetchMe()

  if (to.path === '/login') {
    if (user.value) return navigateTo('/')
    return
  }

  if (!user.value) {
    return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`)
  }

  if (to.path === '/settings') {
    const role = user.value.globalRole || user.value.global_role
    if (!['admin', 'operator'].includes(role)) return navigateTo('/')
  }

  if (to.path === '/users') {
    const role = user.value.globalRole || user.value.global_role
    if (role !== 'admin') return navigateTo('/')
  }
})
