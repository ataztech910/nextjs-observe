import {describe,expect,it} from 'vitest';
import {deck} from '@/deck/deck';
import {stepNumber} from '@/lib/step-number';

describe('performance talk contract',()=>{
  it('stops the 25-minute main route at the takeaway; appendices return to Q&A',()=>{
    const main=deck.steps.filter(s=>!s.returnToStep);
    expect(main.map(s=>s.id)).toEqual(['slide-01','slide-02','slide-03','slide-04','slide-05','slide-06','slide-07','slide-08']);
    expect(main.at(-1)?.next).toBeNull();
    for(const s of deck.steps.filter(s=>s.returnToStep)){
      expect(s.returnToStep).toBe('slide-08');
      expect(stepNumber(deck.steps,s.id)).toEqual({number:8,total:8});
    }
  });
  it('keeps failed delivery, source boundaries and the actual uncertainty with the audience',()=>{
    const text=deck.nodes.map(n=>`${n.subtitle}\n${n.detail?.bullets?.join('\n')}`).join('\n');
    for(const value of ['214.2 · 200.8 · 213.3 · 213.6 ms','1871 B','8275 B','+21.433 ms [1.450, 44.650]','Deliberate queue overflow: 20 dropped spans — Delivery state: incomplete','HTTP400 rejection — Delivery state: failed','Source: pipeline-1794641370737-5d72','unavailable in the retained Simulator hitch probe'])expect(text).toContain(value);
    expect(text).not.toContain('Timing:');
    expect(deck.nodes.find(n=>n.id==='slide-08')?.detail?.note).toContain('Timing: 23:00–25:00');
  });
  it('has resolvable edges, focus IDs and disjoint collapsed card positions',()=>{
    const ids=new Set(deck.nodes.map(n=>n.id));
    expect(ids.size).toBe(10);
    for(const step of deck.steps)for(const id of step.focus)expect(ids.has(id)).toBe(true);
    for(const edge of deck.edges){expect(ids.has(edge.from)).toBe(true);expect(ids.has(edge.to)).toBe(true);}
    expect(new Set(deck.nodes.map(n=>`${n.x}:${n.y}`)).size).toBe(10);
  });
});
