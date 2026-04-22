import { useState, useCallback, useMemo, useEffect } from "react";

// Reusable selection state for any list of items with unique `id` fields.
// Current-page-scoped: selection clears when the caller changes the item set
// (via the `items` argument below). Matches the behavior of Gmail and most
// other list UIs: checking a box does not persist across page navigations.
//
// Usage:
//   const sel = useBulkSelection(filteredTechPacks);
//   sel.isSelected(tp.id)
//   sel.toggle(tp.id)
//   sel.selectAll()
//   sel.clear()
//   sel.size            // number selected
//   sel.selectedItems   // full objects, not just ids
//   sel.allVisible      // true when every item in the current list is checked
//
// The hook does NOT persist to localStorage, does not survive a page refresh,
// and does not scope across pagination. Those are all things a caller can
// layer on if needed.
export function useBulkSelection(items) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // If the caller's list shrinks (filter change, item deleted, pagination),
  // prune any stale IDs from the selection so `size` and `selectedItems`
  // stay in sync with what the user can actually see.
  const visibleIds = useMemo(() => new Set(items.map(i => i.id)), [items]);
  useEffect(() => {
    setSelectedIds(prev => {
      let dirty = false;
      for (const id of prev) {
        if (!visibleIds.has(id)) { dirty = true; break; }
      }
      if (!dirty) return prev;
      const next = new Set();
      for (const id of prev) if (visibleIds.has(id)) next.add(id);
      return next;
    });
  }, [visibleIds]);

  const isSelected = useCallback((id) => selectedIds.has(id), [selectedIds]);

  const toggle = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items.map(i => i.id)));
  }, [items]);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectedItems = useMemo(
    () => items.filter(i => selectedIds.has(i.id)),
    [items, selectedIds]
  );

  const allVisible = items.length > 0 && items.every(i => selectedIds.has(i.id));

  return {
    selectedIds,
    selectedItems,
    size: selectedIds.size,
    isSelected,
    toggle,
    selectAll,
    clear,
    allVisible,
  };
}

