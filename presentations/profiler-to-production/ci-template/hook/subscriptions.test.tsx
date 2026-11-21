// Check counts, not milliseconds: open and close the screen 30 times, then no subscriber may be left.
// HOOK=leaky runs the same test against the bug to prove the test catches it.
import { renderHook } from '@testing-library/react'
import { expect, test } from 'vitest'
import { orderUpdates } from './order-updates'

const { useOrderUpdates } = process.env.HOOK === 'leaky' ? await import('./useOrderUpdates.leaky') : await import('./useOrderUpdates')

test('a closed screen keeps no order-update subscriptions', () => {
  let calls = 0
  for (let visit = 0; visit < 30; visit++) {
    const screen = renderHook(() => useOrderUpdates(() => { calls++ }))
    screen.unmount()
  }
  expect(orderUpdates.listenerCount()).toBe(0)
  orderUpdates.emit({ id: 1, status: 'ready' })
  expect(calls).toBe(0)
})
