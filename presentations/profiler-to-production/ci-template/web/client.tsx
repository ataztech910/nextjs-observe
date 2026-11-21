import React, { Suspense } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { Catalog } from './Catalog'

const script = document.documentElement.dataset.script
hydrateRoot(document, <html data-script={script}><head><title>Streaming catalog</title>
  <script type="module" src="/client.js" async={script === 'async'} />
</head><body><Catalog /><Suspense fallback={<p id="fallback">Loading recommendations</p>}>
  <section id="recommendations">Recommendations ready</section>
</Suspense></body></html>)
