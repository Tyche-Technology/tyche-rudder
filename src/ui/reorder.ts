// The ONLY ordering math for the backlog board — both drag and keyboard
// events resolve their target through these two pure functions before
// calling POST /api/v1/issues/{id}/reorder. Keeping the math here (not in
// board-column.tsx) is what makes it unit-testable without a DOM.

export type Target = { afterId: number } | { beforeId: number }

// list without draggedId, inserting at dropIndex: prev exists → { afterId:
// prev }; else next exists → { beforeId: next }; else null (single-item
// list → no-op). dropIndex is an index into the OTHER cards only — the
// caller computes it by excluding the dragged card from the midpoint scan,
// so dropping back onto the dragged card's own gap naturally reproduces its
// existing neighbor here rather than tripping a special case. Callers must
// separately skip the request when that reproduced neighbor is unchanged.
export function reorderTarget(orderedIds: number[], draggedId: number, dropIndex: number): Target | null {
  const others = orderedIds.filter((id) => id !== draggedId)
  const clamped = Math.max(0, Math.min(dropIndex, others.length))
  const prev = others[clamped - 1]
  if (prev !== undefined) return { afterId: prev }
  const next = others[clamped]
  if (next !== undefined) return { beforeId: next }
  return null
}

// up → { beforeId: previous id } (null at top); down → { afterId: next id }
// (null at bottom).
export function keyboardTarget(orderedIds: number[], id: number, dir: 'up' | 'down'): Target | null {
  const idx = orderedIds.indexOf(id)
  if (idx === -1) return null
  if (dir === 'up') {
    if (idx <= 0) return null
    return { beforeId: orderedIds[idx - 1] }
  }
  if (idx >= orderedIds.length - 1) return null
  return { afterId: orderedIds[idx + 1] }
}

// Whether committing `target` for `draggedId` would just reproduce its
// current spot. Must be checked against the CANONICAL order, never a
// filtered view: a filtered view's neighbor can differ from the canonical
// one (a hidden card can sit between the visible anchor and draggedId), so
// checking there can mistake a real move for a no-op and silently drop the
// request. `orderedIds` here is intentionally the caller's full board order.
export function isNoopReorder(orderedIds: number[], draggedId: number, target: Target): boolean {
  const idx = orderedIds.indexOf(draggedId)
  return 'afterId' in target
    ? orderedIds[idx - 1] === target.afterId
    : orderedIds[idx + 1] === target.beforeId
}
