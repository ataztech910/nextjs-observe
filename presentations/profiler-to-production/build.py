"""Build an offline deck from the reviewed Markdown. Python standard library only."""
from pathlib import Path
import html
import re

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "../../docs/research/performance-observability/CONFERENCE_SLIDES.md"
DOCS = "../../docs/research/performance-observability/"


def inline(text):
    text = html.escape(text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    def link(match):
        label, target = match.groups()
        if not re.fullmatch(r"[A-Z_]+\.(?:md|json)(?:#[a-z0-9-]+)?", target):
            raise ValueError("Unexpected evidence link: " + target)
        return f'<a href="{DOCS}{target}" target="_blank" rel="noopener">{label}</a>'
    return re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link, text)


def markdown(text):
    blocks = []
    lines = text.strip().splitlines()
    i = 0
    while i < len(lines):
        if not lines[i].strip():
            i += 1
            continue
        if lines[i].startswith("| "):
            table = []
            while i < len(lines) and lines[i].startswith("| "):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r"[-: ]+", c) for c in cells):
                    table.append(cells)
                i += 1
            blocks.append('<table><thead><tr>' + ''.join('<th scope="col">'+inline(c)+'</th>' for c in table[0]) + '</tr></thead><tbody>' + ''.join('<tr>'+''.join('<td>'+inline(c)+'</td>' for c in row)+'</tr>' for row in table[1:])+'</tbody></table>')
        elif lines[i].startswith("- "):
            items = []
            while i < len(lines) and lines[i].startswith("- "):
                items.append('<li>'+inline(lines[i][2:])+'</li>')
                i += 1
            blocks.append('<ul>'+''.join(items)+'</ul>')
        else:
            paragraph = []
            while i < len(lines) and lines[i].strip() and not lines[i].startswith(("| ", "- ")):
                paragraph.append(lines[i])
                i += 1
            blocks.append('<p>'+inline(' '.join(paragraph))+'</p>')
    return '\n'.join(blocks)


def build():
    source = SOURCE.read_text()
    matches = list(re.finditer(r"^## (0[1-8]|A[12]) — (.+)$", source, re.M))
    if [m[1] for m in matches] != ['01','02','03','04','05','06','07','08','A1','A2']:
        raise ValueError("Expected eight core slides and two appendices")
    slides, overview = [], []
    for n, match in enumerate(matches):
        end = matches[n+1].start() if n+1 < len(matches) else source.index('## Editorial handoff')
        body = source[match.end():end].strip().removesuffix('---').strip()
        on_screen, rest = body.split('**On screen**', 1)[1].split('**Speaker notes**', 1)
        notes, evidence = rest.split('**Evidence cue**', 1)
        paragraphs = on_screen.strip().split('\n\n')
        foot, content = [], []
        for paragraph in paragraphs:
            (foot if paragraph.startswith(('Source:', 'Sources:', 'Endpoint:', 'Boundary:')) else content).append(paragraph)
        sid, title = match[1], html.escape(match[2])
        chapter = {'01':'Opening','02':'Measurement model','03':'Experiment A','04':'Experiment B','05':'Architecture','06':'Experiment F / delivery','07':'Experiment F / cost','08':'Takeaway','A1':'Appendix / React Native','A2':'Appendix / Maestro'}[sid]
        slides.append(f'<section class="slide slide-{sid}" id="slide-{sid}" data-title="{title}" aria-label="Slide {sid}: {title}"'+('' if n == 0 else ' hidden')+f'><div class="paper"><header><span class="brand"><i></i> PROFILER → PRODUCTION</span><span>{chapter}</span></header><div class="slide-content"><div class="eyebrow">{sid} / {chapter}</div><h1>{title}</h1><div class="copy">{markdown((chr(10)*2).join(content))}</div></div><footer><div class="evidence">{markdown((chr(10)*2).join(foot))}</div><span class="folio">{sid} <span>/ 10</span></span></footer></div><aside class="speaker" hidden><h2>Speaker notes · {sid}</h2>{markdown(notes)}<h3>Evidence cue</h3>{markdown(evidence)}</aside></section>')
        overview.append(f'<button data-slide="{sid}"><span>{sid}</span>{title}</button>')
    template = (ROOT/'template.html').read_text()
    result = template.replace('<!-- SLIDES -->', '\n'.join(slides)).replace('<!-- OVERVIEW -->', '\n'.join(overview)).replace('/* STYLES */', (ROOT/'style.css').read_text()).replace('// SCRIPT', (ROOT/'deck.js').read_text())
    (ROOT/'index.html').write_text(result)
    return len(slides)


if __name__ == '__main__':
    print(f'Built {build()} slides → {ROOT / "index.html"}')
