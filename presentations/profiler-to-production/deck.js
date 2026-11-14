(() => {
  const slides = [...document.querySelectorAll('.slide')];
  const ids = slides.map(slide => slide.id);
  const previous = document.querySelector('#previous');
  const next = document.querySelector('#next');
  const notes = document.querySelector('#notes');
  const overview = document.querySelector('#overview');
  let active = 0;
  let showNotes = false;

  function render() {
    const index = ids.indexOf(location.hash.slice(1));
    active = index < 0 ? 0 : index;
    slides.forEach((slide, i) => {
      slide.hidden = i !== active;
      slide.querySelector('.speaker').hidden = !showNotes;
    });
    previous.disabled = active === 0;
    next.disabled = active === slides.length - 1;
    document.querySelector('#position').textContent = `${slides[active].id.slice(6)} / ${slides.length}`;
    notes.setAttribute('aria-expanded', String(showNotes));
    document.body.classList.toggle('has-notes', showNotes);
    overview.querySelectorAll('[data-slide]').forEach(button => {
      button.setAttribute('aria-current', String(`slide-${button.dataset.slide}` === ids[active]));
    });
    document.title = `${slides[active].dataset.title} — Profiler to Production`;
  }
  function go(index) {
    const target = ids[Math.max(0, Math.min(slides.length - 1, index))];
    if (location.hash !== `#${target}`) location.hash = target;
    else render();
  }
  function toggleNotes() { showNotes = !showNotes; render(); }
  function toggleOverview() { if (overview.open) overview.close(); else overview.showModal(); }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { document.querySelector('#fullscreen').textContent = 'Fullscreen unavailable'; }
  }
  previous.addEventListener('click', () => go(active - 1));
  next.addEventListener('click', () => go(active + 1));
  notes.addEventListener('click', toggleNotes);
  document.querySelector('#contents').addEventListener('click', toggleOverview);
  document.querySelector('#close-overview').addEventListener('click', () => overview.close());
  overview.querySelectorAll('[data-slide]').forEach(button => button.addEventListener('click', () => {
    go(ids.indexOf(`slide-${button.dataset.slide}`)); overview.close();
  }));
  document.querySelector('#fullscreen').addEventListener('click', fullscreen);
  document.querySelector('#print').addEventListener('click', () => { if (overview.open) overview.close(); window.print(); });
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input,textarea,select,[contenteditable]')) return;
    if (overview.open) return;
    if (event.key === 'Escape') { showNotes = false; render(); return; }
    if (['ArrowRight', 'PageDown'].includes(event.key) || (event.key === ' ' && event.target === document.body)) {
      event.preventDefault(); go(active + 1);
    } else if (['ArrowLeft', 'PageUp'].includes(event.key)) { event.preventDefault(); go(active - 1); }
    else if (event.key === 'Home') { event.preventDefault(); go(0); }
    else if (event.key === 'End') { event.preventDefault(); go(slides.length - 1); }
    else if (event.key.toLowerCase() === 'n') toggleNotes();
    else if (event.key.toLowerCase() === 'o') toggleOverview();
    else if (event.key.toLowerCase() === 'f') fullscreen();
  });
  window.addEventListener('hashchange', render);
  render();
})();
