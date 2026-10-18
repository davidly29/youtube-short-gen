import { checkImagePrompt } from "@shortloop/providers";

export type PolicyCategory =
  | "impersonation"
  | "medical_advice"
  | "financial_advice"
  | "hate_harassment"
  | "minors"
  | "trademarked_character"
  | "copyrighted_lyrics";

export interface PolicyResult {
  allow: boolean;
  reasons: { category: PolicyCategory; message: string }[];
}

const has = (re: RegExp, s: string) => re.test(s);

const DISCLAIMER =
  /\b(not (medical|financial|investment) advice|consult (a|your) (doctor|physician|financial advisor|professional)|talk to (a|your) (doctor|advisor)|for (educational|informational) purposes only)\b/i;

const RULES: { category: PolicyCategory; message: string; test: (s: string) => boolean }[] = [
  {
    category: "impersonation",
    message: "Speaks as, or puts words in the mouth of, a real named person.",
    test: (s) =>
      has(
        /\b(i am|i'm|this is)\s+(elon musk|taylor swift|mr\.? ?beast|joe biden|donald trump|barack obama|king charles)\b/i,
        s,
      ) ||
      has(
        /\b(elon musk|taylor swift|mr\.? ?beast|joe biden|donald trump|barack obama|king charles|bill gates)\s+(said|says|told me|admits|confessed)\s*[:,"“]/i,
        s,
      ),
  },
  {
    category: "medical_advice",
    message: "Gives medical treatment or dosage advice without a disclaimer.",
    test: (s) =>
      has(
        /\b(take|stop taking|double|increase|reduce)\s+(your\s+)?(\d+\s?mg|dose|dosage|medication|insulin|antibiotics|antidepressants)\b|\bcures?\s+(cancer|diabetes|autism|depression)\b|\binstead of (chemo|your medication|seeing a doctor)\b/i,
        s,
      ) && !DISCLAIMER.test(s),
  },
  {
    category: "financial_advice",
    message: "Gives specific financial/investment instructions without a disclaimer.",
    test: (s) =>
      has(
        /\b(buy|sell|short|go all[- ]in on|put your savings (in|into))\s+[A-Z$]{2,6}\b|\bguaranteed (returns?|profit)\b|\bcan'?t lose\b|\b(\d{2,4})x (gains|returns)\b/i,
        s,
      ) && !DISCLAIMER.test(s),
  },
  {
    category: "hate_harassment",
    message: "Attacks people for a protected characteristic or targets an individual.",
    test: (s) =>
      has(
        /\b(subhuman|vermin|should (all )?be (killed|deported|eliminated)|go back to (your|their) (own )?country|kill all|exterminate)\b/i,
        s,
      ) || has(/\b(dox|doxx|leak (his|her|their) address|find where (he|she|they) lives?)\b/i, s),
  },
  {
    category: "minors",
    message: "Sexualises or endangers minors.",
    test: (s) =>
      has(
        /\b(child|children|kid|kids|minor|minors|teen|teens|\d{1,2}[- ]year[- ]old|schoolgirl|schoolboy)\b/i,
        s,
      ) &&
      has(
        /\b(sexy|sexual|seductive|lingerie|nude|naked|date an adult|meet (up )?in secret|keep (it|this) secret from (your )?parents)\b/i,
        s,
      ),
  },
  {
    category: "trademarked_character",
    message: "Uses a trademarked character, brand or real person's likeness.",
    test: (s) => !checkImagePrompt(s).ok,
  },
  {
    category: "copyrighted_lyrics",
    message: "Reproduces song lyrics.",
    test: (s) =>
      has(
        /\b(here are the (full )?lyrics|sing along:|lyrics to|the lyrics of|verse 1:|\[chorus\]|chorus:)\b/i,
        s,
      ),
  },
];

/** Rule-based first pass over script text or a generation prompt. */
export function policyCheck(text: string): PolicyResult {
  const reasons = RULES.filter((r) => r.test(text)).map(({ category, message }) => ({ category, message }));
  return { allow: reasons.length === 0, reasons };
}

/** Run the check on every spoken line and visual query of a script. */
export function policyCheckScript(script: {
  hook: string;
  beats: { text: string; visualQuery: string }[];
  cta: string;
}): PolicyResult {
  const text = [script.hook, ...script.beats.flatMap((b) => [b.text, b.visualQuery]), script.cta].join("\n");
  return policyCheck(text);
}
