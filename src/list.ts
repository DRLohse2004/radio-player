/** Eintrag verschieben wie beim Ziehen: toIndex ist der Platz in der alten Liste, vor den er kommt
 *  (list.length = ans Ende). Ungültiges ändert nichts und liefert dieselbe Liste zurück. */
export function moveTo<T extends { id: string }>(list: T[], id: string, toIndex: number): T[] {
  const from = list.findIndex((x) => x.id === id);
  if (from < 0 || !Number.isInteger(toIndex) || toIndex < 0 || toIndex > list.length) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(from < toIndex ? toIndex - 1 : toIndex, 0, moved);
  return next;
}
