/**
 * Editorial page header — serif italic hero (matching the cream-paper reference)
 * for welcome pages, calmer h1 for the rest. The eyebrow line carries a small
 * primary dot, like a magazine kicker.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  hero = false,
}: {
  /** Small uppercase label above the title (e.g. "Conductor", "Memory"). */
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Use the larger, italic-serif treatment for welcome pages. */
  hero?: boolean;
}) {
  return (
    <div className="relative mb-7 animate-rise-in">
      <div className="flex items-end justify-between gap-4 pb-4">
        <div className="space-y-2">
          {eyebrow && (
            <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-primary">
              <span aria-hidden className="size-1.5 rounded-full bg-primary" />
              {eyebrow}
            </p>
          )}
          {hero ? (
            <h1 className="text-serif text-[34px] font-semibold italic leading-[1.05] tracking-tight text-foreground md:text-[44px]">
              {title}
            </h1>
          ) : (
            <h1 className="text-serif text-[24px] font-semibold italic leading-tight tracking-tight text-foreground md:text-[28px]">
              {title}
            </h1>
          )}
          {description && (
            <p
              className={
                hero
                  ? "max-w-2xl text-[15px] leading-relaxed text-muted-foreground"
                  : "text-[13.5px] text-muted-foreground"
              }
            >
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
      <div
        aria-hidden
        className="h-px w-full origin-left scale-x-0 bg-border [animation:underlineIn_0.6s_var(--ease-ink)_0.15s_forwards]"
      />
    </div>
  );
}
