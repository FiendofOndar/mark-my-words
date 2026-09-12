/**
 * A short list of notes, warnings or blockers.
 *
 * One item renders as a sentence. A bullet in front of a single line is not a
 * list, it is a dot, and three different panels had grown their own version of
 * it by typing "·" in front of every item.
 */
export function Bullets({ items, className = '' }: { items: string[]; className?: string }) {
  if (items.length === 0) return null;

  if (items.length === 1) {
    return <p className={className}>{items[0]}</p>;
  }

  return (
    <ul className={`list-disc space-y-1 pl-4 marker:text-current ${className}`}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
