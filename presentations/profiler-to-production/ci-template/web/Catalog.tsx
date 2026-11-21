import React, { useState } from 'react';

const products = [
  { id: 'lamp', name: 'Desk lamp', price: 45 },
  { id: 'notebook', name: 'Notebook', price: 12 },
  { id: 'mug', name: 'Coffee mug', price: 18 },
];

// The catalog from investigation 01 (copied from research/StreamingCatalog.tsx without the lab probe).
export function Catalog() {
  const [sorted, setSorted] = useState(false);
  const items = sorted ? [...products].sort((a, b) => a.price - b.price) : products;
  return <main><h1>Small catalog</h1><p>Sort the products already shown on this page.</p>
    <button type="button" onClick={event => {
      setSorted(true);
    }}>Price: low to high</button>
    <p role="status">{sorted ? 'Sorted by price' : 'Original order'}</p>
    <ul>{items.map(item => <li key={item.id} data-product={item.id}>{`${item.name} — €${item.price}`}</li>)}</ul>
  </main>;
}
