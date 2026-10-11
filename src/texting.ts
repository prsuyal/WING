export function chatText(text: string) {
  // URLs contain case-sensitive tokens; only format the surrounding prose.
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) => i % 2 ? part : part.toLowerCase().replace(/\s*—\s*/g, ", ").replace(/\[demo\]/g, "[simulated]").replace(/\.(?=$|\n)/g, "")).join("").trim();
}

export function chatBubbles(text: string) {
  const sentences = new Intl.Segmenter("en", { granularity: "sentence" });
  return chatText(text).split(/\n\s*\n/).flatMap((paragraph) => {
    const lines = paragraph.split("\n").map((line) => line.trim()).filter(Boolean);
    // A numbered menu or a flight segment is one structured thought, not prose to fragment.
    if (lines.every((line) => /^\d+[.)]\s/.test(line)) || /^(outbound|return|connection):/.test(lines[0] ?? "")) return lines.length ? [lines.join("\n")] : [];
    return lines.flatMap((line) => {
      const urls: string[] = [];
      const protectedLine = line.replace(/https?:\/\/[^\s]+/g, (url) => { urls.push(url); return `URLTOKEN${urls.length - 1}`; });
      return [...sentences.segment(protectedLine)].map(({ segment }) => segment.trim().replace(/\.$/, "").replace(/URLTOKEN(\d+)/g, (_, index) => urls[Number(index)]!));
    });
  }).filter(Boolean);
}
