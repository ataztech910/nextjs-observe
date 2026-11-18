"""Generate this talk's data for the copied graph engine."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parents[2] / 'docs/research/performance-observability/CONFERENCE_SLIDES.md'


def plain(text):
    return re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'\1 (\2)', text).replace('**', '').replace('`', '')


def audience(text):
    bullets, context = [], []
    for block in text.strip().split('\n\n'):
        if block.startswith(('Source:', 'Sources:', 'Endpoint:', 'Boundary:')):
            context.append(plain(' '.join(block.splitlines())))
        elif block.startswith('|'):
            rows = [[plain(c.strip()) for c in line.strip().strip('|').split('|')] for line in block.splitlines()]
            rows = [row for row in rows if not all(re.fullmatch(r'[-: ]+', c) for c in row)]
            for row in rows[1:]:
                assert len(row) == len(rows[0])
                bullets.append(row[0] + ' — ' + '; '.join(f'{head}: {value}' for head, value in zip(rows[0][1:], row[1:])))
        elif block.startswith('- '):
            bullets.extend(plain(line[2:]) for line in block.splitlines())
        else:
            bullets.append(plain(' '.join(block.splitlines())))
    return bullets, context


def build():
    text = SOURCE.read_text()
    matches = list(re.finditer(r'^## (0[1-8]|A[12]) — (.+)$', text, re.M))
    assert [m[1] for m in matches] == ['01','02','03','04','05','06','07','08','A1','A2']
    nodes, steps, edges = [], [], []
    for i, match in enumerate(matches):
        end = matches[i+1].start() if i+1 < len(matches) else text.index('## Editorial handoff')
        body = text[match.end():end].strip().removesuffix('---').strip()
        screen, rest = body.split('**On screen**', 1)[1].split('**Speaker notes**', 1)
        notes, evidence = rest.split('**Evidence cue**', 1)
        bullets, context = audience(screen)
        if i == 0 and bullets[0] == match[2]: bullets.pop(0)
        sid = match[1]
        part = 'Main talk · 25 minutes' if i < 8 else 'Q&A · within 5 minutes'
        label = {'01':'30 minutes total','06':'Controlled delivery faults','07':'No accepted overhead budget','A1':'Presentation unavailable','A2':'Runner ≠ archive state'}.get(sid, 'Scoped evidence')
        x, y = (240+(i%4)*1120, 300+(i//4)*1500) if i < 8 else (1360+(i-8)*1120,3300)
        nodes.append({'id':f'slide-{sid}','title':match[2],'subtitle':' '.join(context) if context else part,'size':'lg','x':x,'y':y,'chips':[{'label':sid,'mono':True}],'badge':{'label':label,'tone':'amber' if sid in ['06','07','A1','A2'] else 'gray'},'detail':{'bullets':bullets,'note':plain(notes.strip())+'\n\nEvidence cue\n'+plain(evidence.strip())}})
        step = {'id':f'slide-{sid}','focus':[f'slide-{sid}'],'part':part,'caption':{'01':'Start with the interaction. Name the endpoint.','08':'25:00 → Q&A. Overview opens the optional appendices.'}.get(sid,'Sources, endpoints and limitations travel with the result.')}
        if sid == '08': step['next'] = None
        if i >= 8: step['returnToStep'] = 'slide-08'
        steps.append(step)
        if 0 < i < 8: edges.append({'from':f'slide-{matches[i-1][1]}','to':f'slide-{sid}'})
        if i >= 8: edges.append({'from':'slide-08','to':f'slide-{sid}','kind':'dashed','label':'Q&A'})
    measurements = json.loads((ROOT/'measurement-cards.json').read_text())
    for node in nodes:
        if node['id'] in measurements:
            card = measurements[node['id']]
            node['title'], node['subtitle'] = card['title'], card['subtitle']
            node['detail']['image'] = card['image']
            node['detail']['bullets'] = card['bullets']
    introduction = json.loads((ROOT/'introduction.json').read_text())
    assert [n['id'] for n in introduction] == ['about-me','gdg-linz']
    nodes[1:1] = introduction
    steps[1:1] = [{'id':n['id'],'focus':[n['id']],'part':'Opening · within 1:30','caption':'Who is talking' if n['id']=='about-me' else 'GDG Linz'} for n in introduction]
    nodes[0]['detail']['note'] = 'Timing: 00:00–00:15 elapsed; budget 0:15. State the title, then introduce yourself and GDG Linz. The full three-card opening finishes at 01:30.\n\n' + nodes[0]['detail']['note'].split('\n',1)[-1].strip()
    for i,node in enumerate(nodes):
        node['x'],node['y'] = 240+(i%4)*2040,300+(i//4)*1600
    main = [s for s in steps if not s.get('returnToStep')]
    edges = [{'from':a['focus'][0],'to':b['focus'][0]} for a,b in zip(main,main[1:])] + [{'from':'slide-08','to':f'slide-{sid}','kind':'dashed','label':'Q&A'} for sid in ['A1','A2']]
    deck = {'meta':{'title':'From Profiler to Production','subtitle':'React & React Native · 25 min + 5 min Q&A'},'nodes':nodes,'edges':edges,'steps':steps}
    data = json.dumps(deck,ensure_ascii=False,indent=2).replace('"photo": "speakerPhoto"','"photo": speakerPhoto').replace('"photo": "communityPhoto"','"photo": communityPhoto').replace('"image": "interactionCard"','"image": interactionCard').replace('"image": "startupCard"','"image": startupCard')
    (ROOT/'src/deck/deck.ts').write_text('// Generated from CONFERENCE_SLIDES.md + introduction.json. Edit sources, then regenerate.\nimport type { Deck } from "./types";\nimport speakerPhoto from "../assets/about/me.jpg?inline";\nimport communityPhoto from "../assets/about/gdg-linz.jpg?inline";\nimport interactionCard from "../assets/measurements/A-interaction.png?inline";\nimport startupCard from "../assets/measurements/B-startup.png?inline";\nexport const deck: Deck = '+data+';\n')
    return deck


if __name__ == '__main__':
    print(f'Generated {len(build()["nodes"])} graph cards from reviewed source')
