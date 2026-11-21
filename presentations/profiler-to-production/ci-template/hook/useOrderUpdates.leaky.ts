import { useEffect } from 'react'
import { orderUpdates } from './order-updates'

// The bug from the talk: the effect subscribes and returns nothing — the subscription outlives the screen.
export function useOrderUpdates(onUpdate: (u: { id: number; status: string }) => void) {
  useEffect(() => {
    orderUpdates.subscribe(onUpdate)
  }, [])
}
