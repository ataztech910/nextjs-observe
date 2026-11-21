import {describe,expect,it} from 'vitest';
import {deck} from '@/deck/deck';
import {stepNumber} from '@/lib/step-number';

describe('performance talk contract',()=>{
  it('ends the main route at the closing card; appendices return to Q&A',()=>{
    const main=deck.steps.filter(s=>!s.returnToStep);
    expect(main.map(s=>s.id)).toEqual(['slide-01','about-me','gdg-linz','performance-question','user-waits','framework-map','framework-proxies','framework-choice','web-early-action-story','web-streaming-lighthouse','web-streaming-diagnosis','web-streaming-devtools','web-streaming-mechanism','web-streaming-comparison','web-streaming-takeaway','web-streaming-frameworks','web-streaming-observability','web-streaming-regression','transition-to-native','framework-native','rn-subscription-scene','rn-subscription-react','rn-subscription-hermes','rn-subscription-counter','rn-subscription-fix','rn-subscription-production','ci-profile-once','ci-checks','ci-template','toolkit-map','thank-you']);
    expect(main.at(-1)?.next).toBeNull();
    for(const s of deck.steps.filter(s=>s.returnToStep)){
      expect(s.returnToStep).toBe('thank-you');
      expect(stepNumber(deck.steps,s.id)).toEqual({number:main.length,total:main.length});
    }
  });
  it('keeps failed delivery, source boundaries and the actual uncertainty with the audience',()=>{
    const text=deck.nodes.map(n=>`${n.subtitle}\n${n.detail?.bullets?.join('\n')}`).join('\n');
    for(const value of ['sampling','300 callbacks','OpenTelemetry','unavailable in the retained Simulator hitch probe'])expect(text).toContain(value);
    expect(text).not.toContain('Timing:');
    expect(deck.steps.find(s=>s.id==='rn-subscription-fix')?.caption).toContain('not measured user latency');
    // The old summary card left the talk: the closing is toolkit-map → (↑) framework-choice → (↑) thank-you.
    expect(deck.nodes.find(n=>n.id==='slide-08')).toBeUndefined();
  });
  it('puts the copied speaker and community images immediately after the title',()=>{
    const speaker=deck.nodes.find(n=>n.id==='about-me')!;
    const community=deck.nodes.find(n=>n.id==='gdg-linz')!;
    expect(speaker.photo).toBeTruthy();expect(community.photo).toBeTruthy();
    expect(speaker.detail?.note).toContain('00:15–01:00');
    expect(community.detail?.note).toContain('01:00–01:30');
    expect(speaker.detail?.qr?.value).toBe('https://www.linkedin.com/in/andrei-tazetdinov/');
    expect(community.detail?.qr?.value).toBe('https://gdg.community.dev/gdg-linz/');
  });
  it('includes distinct measurement images and keeps the complete source notes',()=>{
    const profile=deck.nodes.find(n=>n.id==='rn-subscription-hermes')!;
    const comparison=deck.nodes.find(n=>n.id==='rn-subscription-fix')!;
    expect(profile.detail?.image).toBeTruthy();expect(comparison.detail?.image).toBeTruthy();
    expect(profile.detail?.image).not.toBe(comparison.detail?.image);
    expect(profile.detail?.note).toContain('Debug');
    expect(comparison.detail?.note).toContain('116,803');
    expect(deck.nodes.find(n=>n.id==='rn-subscription-react')?.detail?.note).toContain('173 коммита');
    expect(deck.nodes.find(n=>n.id==='rn-subscription-production')?.detail?.note).toContain('пока не проверены');
    expect(deck.nodes.find(n=>n.id==='framework-choice')?.detail?.image).toBeTruthy();
  });
  it('has resolvable edges, focus IDs and disjoint collapsed card positions',()=>{
    const ids=new Set(deck.nodes.map(n=>n.id));
    expect(ids.size).toBe(deck.nodes.length);
    for(const step of deck.steps)for(const id of step.focus)expect(ids.has(id)).toBe(true);
    for(const edge of deck.edges){expect(ids.has(edge.from)).toBe(true);expect(ids.has(edge.to)).toBe(true);}
    expect(new Set(deck.nodes.map(n=>`${n.x}:${n.y}`)).size).toBe(deck.nodes.length);
  });
});
