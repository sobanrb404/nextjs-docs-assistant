export interface Source {
  heading: string;
  url: string;
}

export default function SourcesPanel({ sources }: { sources: Source[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {sources.map((s, i) => (
        <a
          key={i}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
        >
          {s.heading}
        </a>
      ))}
    </div>
  );
}
