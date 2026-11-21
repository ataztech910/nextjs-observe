// The subscription from investigation 02, as a hook any screen can use (React DOM or React Native — the hook is the same).
type Listener = (update: { id: number; status: string }) => void
const listeners = new Set<Listener>()

export const orderUpdates = {
  subscribe(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn) } },
  emit(update: { id: number; status: string }) { for (const fn of listeners) fn(update) },
  listenerCount: () => listeners.size, // the counter from the talk — one number the profiler cannot give you
}
