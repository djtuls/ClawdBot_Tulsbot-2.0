export interface BriefFrame {
  whatMatters: string[];
  whyItMatters: string[];
  whatToDo: string[];
}

function clean(items: string[]): string[] {
  return items
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);
}

export function build30SecondSection(frame: BriefFrame): string[] {
  const out: string[] = [];
  const matters = clean(frame.whatMatters);
  const why = clean(frame.whyItMatters);
  const next = clean(frame.whatToDo);

  if (matters.length) {
    out.push("\n🎯 <b>What matters now</b>");
    for (const i of matters) {
      out.push(`• ${i}`);
    }
  }
  if (why.length) {
    out.push("\n🧭 <b>Why it matters</b>");
    for (const i of why) {
      out.push(`• ${i}`);
    }
  }
  if (next.length) {
    out.push("\n✅ <b>What to do</b>");
    for (const i of next) {
      out.push(`• ${i}`);
    }
  }

  return out;
}
