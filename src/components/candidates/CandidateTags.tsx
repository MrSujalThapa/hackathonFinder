export function CandidateTags({ themes }: { themes: string[] }) {
  if (!themes.length) return null;

  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Themes">
      {themes.slice(0, 6).map((theme) => (
        <li
          key={theme}
          className="rounded-md border border-border/80 bg-white/[0.03] px-2 py-0.5 text-[11px] text-foreground/75"
        >
          {theme}
        </li>
      ))}
    </ul>
  );
}
