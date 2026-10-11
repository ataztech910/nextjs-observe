import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Many tests start real HTTP servers and load the agents (ADK and the model adapters) for the first time in their
    // worker. Alone that takes 1–2 s; with the default 5 s two of them failed a publish on a machine that was also
    // running a model CLI, the shop and two dev servers. `npm publish` runs the tests — it must not depend on an idle
    // machine. A test that needs longer still sets its own timeout.
    testTimeout: 20_000,
  },
})
