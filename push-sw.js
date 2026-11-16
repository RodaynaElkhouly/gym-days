// Loaded into the app's service worker. Reminders arrive as empty pushes (the
// server only knows the times); the text is written here from data on the phone,
// so her plan, food and water never leave it.

/* global self, indexedDB */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('gym-days')
    // Don't create the database from here if the app hasn't yet
    req.onupgradeneeded = () => req.transaction.abort()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function getAll(db, store, date) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(store)) return resolve([])
    const os = db.transaction(store, 'readonly').objectStore(store)
    const req = date != null ? os.index('date').getAll(date) : os.getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

const pad = (n) => String(n).padStart(2, '0')
const isoToday = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}
const amount = (n) => {
  const whole = Math.floor(n + 1e-9)
  const half = n - whole >= 0.5 - 1e-9
  return whole === 0 && half ? '½' : `${whole}${half ? '½' : ''}`
}

async function reminder() {
  const out = { title: '💧 Water time', body: 'A good moment for some water.' }
  try {
    const db = await openDb()
    const now = new Date()
    const today = isoToday(now)
    const plans = await getAll(db, 'dietPlans')
    const plan = plans.sort((a, b) => b.createdAt - a.createdAt)[0]
    const log = await getAll(db, 'dayLog', today)
    const food = await getAll(db, 'foodLog', today)
    db.close()
    if (!plan) return out

    const mins = now.getHours() * 60 + now.getMinutes()
    const snack =
      plan.reminders?.snacks !== false &&
      plan.slots.find((s) => s.kind === 'snack' && Math.abs(minutesOf(s.time) - mins) <= 20 && !food.some((f) => f.slotId === s.id))
    if (snack) {
      const choices = snack.options.map((o) => o.text)
      return {
        title: `🍎 ${snack.name} time`,
        body: choices.length > 1 ? `Your choices: ${choices.slice(0, -1).join(', ')} or ${choices[choices.length - 1]}` : choices[0] || 'Time for your snack.',
        url: './#/diet',
      }
    }

    const container = plan.container || { name: 'bottle', ml: 600 }
    const ml = Math.max(0, log.filter((e) => e.kind === 'water').reduce((t, e) => t + (e.ml || 0), 0))
    const had = ml / container.ml
    const goal = plan.waterGoalMl / container.ml
    out.body = had >= goal ? `${amount(had)} ${container.name}s today, goal reached.` : `${amount(had)} of ${amount(goal)} ${container.name}s so far today.`
  } catch {
    // Show the plain reminder
  }
  return out
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    reminder().then((r) =>
      self.registration.showNotification(r.title, { body: r.body, icon: 'pwa-192x192.png', tag: 'sculpit-reminder', data: { url: r.url || './#/diet' } }),
    ),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || './#/diet', self.registration.scope).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.registration.scope))
      if (open) return open.focus().then((c) => c.navigate?.(url) ?? c)
      return self.clients.openWindow(url)
    }),
  )
})
