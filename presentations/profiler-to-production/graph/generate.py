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
        part = 'Main talk' if i < 8 else 'Appendix · Q&A'
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
            if card.get('image'): node['detail']['image'] = card['image']
            node['detail']['bullets'] = card['bullets']
            if card.get('note'): node['detail']['note'] = card['note']
            if node['id'] == 'slide-02':
                node['badge']['label'] = 'Investigation 01 · Web'
    introduction = json.loads((ROOT/'introduction.json').read_text())
    assert [n['id'] for n in introduction] == ['about-me','gdg-linz']
    nodes[1:1] = introduction
    steps[1:1] = [{'id':n['id'],'focus':[n['id']],'part':'Opening','caption':'Who is talking' if n['id']=='about-me' else 'GDG Linz'} for n in introduction]
    for example in json.loads((ROOT/'mini-examples.json').read_text()):
        index = next(i for i, n in enumerate(nodes) if n['id'] == example['after']) + 1
        nodes.insert(index, {'id':example['id'], 'title':example['title'], 'subtitle':example['subtitle'],
            'size':'lg', 'x':0, 'y':0, 'chips':[{'label':example.get('label', 'Mini-example')}],
            'badge':{'label':example.get('badge', 'Diagnostic illustration'),'tone':'amber'},
            'detail':{'image':example.get('image', ''), 'bullets':example['bullets'], 'note':example['note']}})
        if example.get('code'): nodes[index]['detail']['code'] = example['code']
        index = next(i for i, s in enumerate(steps) if s['id'] == example['after']) + 1
        steps.insert(index, {'id':example['id'], 'focus':[example['id']], 'part':example.get('part', 'Web · Mini-examples'),
            'caption':example.get('caption', 'Controlled example. Mechanism and performance acceptance are separate.')})
    # The closing card stays on screen during Q&A: the main route ends there and the appendices return to it.
    closing = next(s for s in steps if s['id'] == 'thank-you')
    for s in steps:
        if s['id'] == 'slide-08': s.pop('next', None)
        if s.get('returnToStep') == 'slide-08': s['returnToStep'] = 'thank-you'
    closing['next'] = None
    # Closing: from the toolkit map, ↑ goes back to the shared method card; ↑ again goes to the end.
    toolkit = next(s for s in steps if s['id'] == 'toolkit-map')
    toolkit['jump'] = {'to': 'framework-choice', 'exit': 'thank-you'}
    # Keep historical evidence in its source files, but do not mix old investigations
    # into the new talk route while the five new cases are being researched.
    historical = {'slide-02', 'mini-mismatch', 'slide-03', 'slide-04', 'mini-layout',
                  'layout-framework-check', 'slide-05', 'slide-06', 'slide-07',
                  # The closing is toolkit-map → (↑) framework-choice → (↑) thank-you; the old summary card is out.
                  'slide-08'}
    nodes = [node for node in nodes if node['id'] not in historical]
    steps = [step for step in steps if step['id'] not in historical]
    for i,node in enumerate(nodes):
        node['x'],node['y'] = 240+(i%5)*2040,300+(i//5)*1600
    main = [s for s in steps if not s.get('returnToStep')]
    edges = [{'from':a['focus'][0],'to':b['focus'][0]} for a,b in zip(main,main[1:])] + [{'from':'thank-you','to':f'slide-{sid}','kind':'dashed','label':'Q&A'} for sid in ['A1','A2']]
    deck = {'meta':{'title':'From Profiler to Production','subtitle':'React & React Native'},'nodes':nodes,'edges':edges,'steps':steps}
    data = json.dumps(deck,ensure_ascii=False,indent=2).replace('"photo": "speakerPhoto"','"photo": speakerPhoto').replace('"photo": "communityPhoto"','"photo": communityPhoto').replace('"image": "interactionCard"','"image": interactionCard').replace('"image": "startupCard"','"image": startupCard').replace('"image": "visibleCard"','"image": visibleCard').replace('"image": "mismatchCard"','"image": mismatchCard').replace('"image": "layoutCard"','"image": layoutCard').replace('"image": "observabilityCard"','"image": observabilityCard').replace('"image": "layoutComparisonCard"','"image": layoutComparisonCard').replace('"image": "metricsFrameworkCard"','"image": metricsFrameworkCard').replace('"image": "metricsFrameworkSharedCard"','"image": metricsFrameworkSharedCard').replace('"image": "streamingEvidenceCard"','"image": streamingEvidenceCard').replace('"image": "lighthouseStreamingCard"','"image": lighthouseStreamingCard').replace('"image": "subscriptionCard"','"image": subscriptionCard').replace('"image": "subscriptionHermesCard"','"image": subscriptionHermesCard').replace('"image": "toolkitMapCard"','"image": toolkitMapCard').replace('"image": "streamingDevtoolsCard"','"image": streamingDevtoolsCard').replace('"image": "thankYouCard"','"image": thankYouCard').replace('"image": "subscriptionReactProfilerCard"','"image": subscriptionReactProfilerCard').replace('"image": "userWaitsCard"','"image": userWaitsCard').replace('"image": "streamingPageCard"','"image": streamingPageCard').replace('"image": "streamingTimelineCard"','"image": streamingTimelineCard').replace('"image": "streamingMechanismCard"','"image": streamingMechanismCard').replace('"image": "sessionCountCard"','"image": sessionCountCard')
    (ROOT/'src/deck/deck.ts').write_text('// Generated from talk Markdown, introduction, measurement cards and mini-examples. Edit sources, then regenerate.\nimport type { Deck } from "./types";\nimport speakerPhoto from "../assets/about/me.jpg?inline";\nimport communityPhoto from "../assets/about/gdg-linz.jpg?inline";\nimport interactionCard from "../assets/measurements/A-interaction.png?inline";\nimport startupCard from "../assets/measurements/B-startup.png?inline";\nimport visibleCard from "../assets/measurements/SSR-visible-interactive.png?inline";\nimport mismatchCard from "../assets/measurements/SSR-mismatch.png?inline";\nimport layoutCard from "../assets/measurements/React-layout.png?inline";\nimport observabilityCard from "../assets/measurements/OTel-action.png?inline";\nimport layoutComparisonCard from "../assets/measurements/Layout-comparison.png?inline";\nimport metricsFrameworkCard from "../assets/measurements/Metrics-framework.svg?inline";\nimport metricsFrameworkSharedCard from "../assets/measurements/Metrics-framework-shared.svg?inline";\nimport streamingEvidenceCard from "../assets/measurements/Streaming-comparison.svg?inline";\nimport lighthouseStreamingCard from "../assets/measurements/Lighthouse-streaming.png?inline";\nimport subscriptionCard from "../assets/measurements/RN-subscription-chart.svg?inline";\nimport subscriptionHermesCard from "../assets/measurements/RN-subscription-hermes.svg?inline";\nimport toolkitMapCard from "../assets/measurements/Toolkit-map.svg?inline";\nimport streamingDevtoolsCard from "../assets/measurements/Streaming-devtools.svg?inline";\nimport thankYouCard from "../assets/measurements/Thank-you.svg?inline";\nimport subscriptionReactProfilerCard from "../assets/measurements/RN-react-profiler-card.svg?inline";\nimport userWaitsCard from "../assets/measurements/User-waits.svg?inline";\nimport streamingPageCard from "../assets/measurements/Streaming-page.svg?inline";\nimport streamingTimelineCard from "../assets/measurements/Streaming-timeline.svg?inline";\nimport streamingMechanismCard from "../assets/measurements/Streaming-mechanism.svg?inline";\nimport sessionCountCard from "../assets/measurements/RN-session-count.svg?inline";\nexport const deck: Deck = '+data+';\n')
    return deck


if __name__ == '__main__':
    print(f'Generated {len(build()["nodes"])} graph cards from reviewed source')
