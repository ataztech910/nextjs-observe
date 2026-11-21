import { useEffect } from 'react'
import { orderUpdates } from './order-updates'

// Fixed: the effect returns its cleanup, so the subscription ends with the screen.
export function useOrderUpdates(onUpdate: (u: { id: number; status: string }) => void) {
  useEffect(() => orderUpdates.subscribe(onUpdate), [])
}
