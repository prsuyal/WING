export function chatText(text: string) {
  // URLs contain case-sensitive tokens; only format the surrounding prose.
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) => i % 2 ? part : part.toLowerCase().replace(/\s*—\s*/g, ", ").replace(/\[demo\]/g, "[simulated]").replace(/\.(?=$|\n)/g, "")).join("").trim();
}

export function chatBubbles(text: string) {
  // Keep related sentences and line breaks together; split only intentional paragraphs.
  return chatText(text).split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
}
