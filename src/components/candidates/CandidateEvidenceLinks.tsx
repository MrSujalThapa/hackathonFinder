import type { CandidateCard } from "@/core/candidates/types";

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block truncate text-sm text-sky-300 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
    >
      {label}
    </a>
  );
}

export function CandidateEvidenceLinks({
  candidate,
}: {
  candidate: CandidateCard;
}) {
  const links = [
    candidate.officialUrl
      ? { href: candidate.officialUrl, label: "Official site" }
      : null,
    candidate.applyUrl
      ? { href: candidate.applyUrl, label: "Apply" }
      : null,
    candidate.socialUrl
      ? { href: candidate.socialUrl, label: "Social / source" }
      : null,
  ].filter(Boolean) as Array<{ href: string; label: string }>;

  if (!links.length) {
    return (
      <p className="text-sm text-amber-200/80">No source links available.</p>
    );
  }

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
        Links
      </h3>
      <ul className="mt-2 space-y-1.5">
        {links.map((link) => (
          <li key={link.href}>
            <ExternalLink href={link.href} label={link.label} />
          </li>
        ))}
      </ul>
    </section>
  );
}
