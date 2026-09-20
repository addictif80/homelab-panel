"use client";

import { useEffect, useRef, useState } from "react";

export function NotesWidget() {
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/notes")
      .then((r) => r.json())
      .then((d) => setContent(d.content ?? ""))
      .finally(() => setLoaded(true));
  }, []);

  function handleChange(value: string) {
    setContent(value);
    setStatus("saving");
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      await fetch("/api/notes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: value }),
      });
      setStatus("saved");
    }, 600);
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-end">
        <span className="text-xs text-neutral-500">
          {status === "saving" ? "Enregistrement..." : status === "saved" ? "Enregistré" : ""}
        </span>
      </div>
      <textarea
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        disabled={!loaded}
        placeholder="Notes personnelles — visibles uniquement par toi sur cette instance."
        rows={6}
        className="w-full resize-none rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none"
      />
    </div>
  );
}
