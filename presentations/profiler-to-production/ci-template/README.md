# Performance checks — CI template from the talk

A profile explains a problem once. A check in CI catches it every time it comes back.
Both checks test **behaviour and counts, not milliseconds**: CI runners are noisy, these are not.

| Check | Catches | Fails with |
| --- | --- | --- |
| `hook/subscriptions.test.tsx` | a `useEffect` that subscribes and never returns its cleanup (investigation 02) | `expected 30 to be 0` |
| `web/early-click.spec.ts` | a visible button that does not work yet — streamed HTML with a blocking `type="module"` entry (investigation 01) | `Expected "Sorted by price", Received "Original order"` |

```sh
npm ci
npm run test:hook                # passes
HOOK=leaky npm run test:hook     # the bug: fails
npm run test:web                 # passes (async entry)
SCRIPT=module npm run test:web   # the bug: fails
```

`performance-checks.yml` is the GitHub Actions workflow — copy it to `.github/workflows/`.

The hook test runs in jsdom with `@testing-library/react`; in a React Native app use `renderHook` from
`@testing-library/react-native` — the hook and the check are the same. Checked locally on 20 November 2026:
each check passed 3/3 on the fix and failed 3/3 on the bug (Chrome 157, Node 24). The workflow itself was not run on GitHub.
