import { describe, it, expect } from 'vitest'
import { reorderTarget, keyboardTarget, isNoopReorder } from '@/ui/reorder'

describe('reorderTarget', () => {
  it('drop at head → beforeId of old first', () => {
    expect(reorderTarget([1, 2, 3, 4], 3, 0)).toEqual({ beforeId: 1 })
  })

  it('drop at tail → afterId of old last', () => {
    expect(reorderTarget([1, 2, 3, 4], 2, 3)).toEqual({ afterId: 4 })
  })

  it('drop between → afterId of left neighbor', () => {
    // [1,2,3,4], drag 4 to between 1 and 2 (dropIndex 1 in [1,2,3] with 4 removed)
    expect(reorderTarget([1, 2, 3, 4], 4, 1)).toEqual({ afterId: 1 })
  })

  it('dropping onto its own current position reproduces its existing neighbor (a caller-side no-op, not a raw null)', () => {
    // [1,2,3,4], drag 2 back onto its own gap: list without 2 is [1,3,4],
    // its own gap is index 1 (between 1 and 3) — same afterId it already has.
    expect(reorderTarget([1, 2, 3, 4], 2, 1)).toEqual({ afterId: 1 })
  })

  it('two-item swap, dragging the first after the second', () => {
    expect(reorderTarget([1, 2], 1, 1)).toEqual({ afterId: 2 })
  })

  it('two-item swap, dragging the second before the first', () => {
    expect(reorderTarget([1, 2], 2, 0)).toEqual({ beforeId: 1 })
  })

  it('single-item list → null (own position is the only position)', () => {
    expect(reorderTarget([5], 5, 0)).toBeNull()
  })
})

describe('keyboardTarget', () => {
  it('up moves before the previous id', () => {
    expect(keyboardTarget([1, 2, 3, 4], 3, 'up')).toEqual({ beforeId: 2 })
  })

  it('down moves after the next id', () => {
    expect(keyboardTarget([1, 2, 3, 4], 2, 'down')).toEqual({ afterId: 3 })
  })

  it('up at top → null', () => {
    expect(keyboardTarget([1, 2, 3], 1, 'up')).toBeNull()
  })

  it('down at bottom → null', () => {
    expect(keyboardTarget([1, 2, 3], 3, 'down')).toBeNull()
  })

  it('two-item swap, moving the first down', () => {
    expect(keyboardTarget([1, 2], 1, 'down')).toEqual({ afterId: 2 })
  })

  it('two-item swap, moving the second up', () => {
    expect(keyboardTarget([1, 2], 2, 'up')).toEqual({ beforeId: 1 })
  })

  it('single-item list → null in both directions', () => {
    expect(keyboardTarget([1], 1, 'up')).toBeNull()
    expect(keyboardTarget([1], 1, 'down')).toBeNull()
  })
})

describe('isNoopReorder', () => {
  it('is a no-op when the target reproduces the existing neighbor', () => {
    expect(isNoopReorder([1, 2, 3, 4], 2, { afterId: 1 })).toBe(true)
    expect(isNoopReorder([1, 2, 3, 4], 2, { beforeId: 3 })).toBe(true)
  })

  it('is not a no-op when the target is a genuinely different neighbor', () => {
    expect(isNoopReorder([1, 2, 3, 4], 1, { afterId: 4 })).toBe(false)
  })

  // Fix round 1, probe case: canonical [A,B,C] = [1,2,3], a product filter
  // hides B so the visible list is [A,C]. Dragging C to sit after A yields
  // {afterId: 1} from the visible list — which matches C's neighbor in the
  // VISIBLE list but not in canonical order (B sits between them there).
  // Checking against the filtered ids (pre-fix behaviour) wrongly calls
  // this a no-op and drops the request; checking against canonical ids
  // (this function's contract) correctly calls it a real move.
  it('is not a no-op against canonical order even when a filtered view would suggest it is', () => {
    expect(isNoopReorder([1, 2, 3], 3, { afterId: 1 })).toBe(false)
  })

  // End-to-end reproduction of the review probe: canonical [A,B,C] = [1,2,3],
  // a product filter hides B, board-column.tsx computes the drop target from
  // the VISIBLE list [1,3] (exactly as it does today), and commitReorder must
  // check that target against the CANONICAL list, not the visible one.
  it('probe: dragging C after A while B is filtered out fires a real request', () => {
    const canonical = [1, 2, 3]
    const visible = [1, 3]
    const target = reorderTarget(visible, 3, 1) // board-column's own math, unchanged by this fix
    expect(target).toEqual({ afterId: 1 })
    expect(isNoopReorder(canonical, 3, target!)).toBe(false) // fixed: request must fire
    expect(isNoopReorder(visible, 3, target!)).toBe(true) // pre-fix bug: same target, wrong (filtered) list, wrongly suppressed
  })
})
