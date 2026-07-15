import { TechnicalLabel } from "@/components/blueprint/TechnicalLabel";

type PageHeaderProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: React.ReactNode;
  titleClassName?: string;
};

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  titleClassName = "",
}: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? (
          <TechnicalLabel className="mb-1">{eyebrow}</TechnicalLabel>
        ) : null}
        <h1
          className={[
            "text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]",
            titleClassName,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-xl text-sm text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
