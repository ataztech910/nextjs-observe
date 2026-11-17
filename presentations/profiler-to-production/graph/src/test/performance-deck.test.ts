import {describe,expect,it} from 'vitest';
import {deck} from '@/deck/deck';
import {stepNumber} from '@/lib/step-number';

describe('performance talk contract',()=>{
  it('stops the 25-minute main route at the takeaway; appendices return to Q&A',()=>{
    const main=deck.steps.filter(s=>!s.returnToStep);
    expect(main.map(s=>s.id)).toEqual(['slide-01','about-me','gdg-linz','slide-02','slide-03','slide-04','slide-05','slide-06','slide-07','slide-08']);
    expect(main.at(-1)?.next).toBeNull();
    for(const s of deck.steps.filter(s=>s.returnToStep)){
      expect(s.returnToStep).toBe('slide-08');
      expect(stepNumber(deck.steps,s.id)).toEqual({number:10,total:10});
    }
  });
  it('keeps failed delivery, source boundaries and the actual uncertainty with the audience',()=>{
    const text=deck.nodes.map(n=>`${n.subtitle}\n${n.detail?.bullets?.join('\n')}`).join('\n');
    for(const value of ['214.2 · 200.8 · 213.3 · 213.6 ms','1871 B','8275 B','+21.433 ms [1.450, 44.650]','Deliberate queue overflow: 20 dropped spans — Delivery state: incomplete','HTTP400 rejection — Delivery state: failed','Source: pipeline-1794641370737-5d72','unavailable in the retained Simulator hitch probe'])expect(text).toContain(value);
    expect(text).not.toContain('Timing:');
    expect(deck.nodes.find(n=>n.id==='slide-08')?.detail?.note).toContain('Timing: 23:00–25:00');
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
  it('has resolvable edges, focus IDs and disjoint collapsed card positions',()=>{
    const ids=new Set(deck.nodes.map(n=>n.id));
    expect(ids.size).toBe(12);
    for(const step of deck.steps)for(const id of step.focus)expect(ids.has(id)).toBe(true);
    for(const edge of deck.edges){expect(ids.has(edge.from)).toBe(true);expect(ids.has(edge.to)).toBe(true);}
    expect(new Set(deck.nodes.map(n=>`${n.x}:${n.y}`)).size).toBe(12);
  });
});
