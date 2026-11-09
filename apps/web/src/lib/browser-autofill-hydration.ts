// Chrome iOS adds __gCrUniqueID to forms and fillable controls before React
// hydrates them, including controls in collapsed/hidden sections. Keep that
// browser-owned metadata intact. Apply only to the native elements affected:
// React's escape hatch skips attribute checks on this element, not descendants.
// It cannot target a single attribute, so don't spread this on containers or
// use it to cover up differences in app-rendered state.
export const browserAutofillHydrationProps = { suppressHydrationWarning: true } as const;
