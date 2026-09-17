import type { PartifulData } from "./partiful";

export type { PartifulData };

export interface TechWeekEvent {
  id: string;
  name: string;
  date: string;
  time: string;
  location: string;
  company: string;
  url: string;
  isInviteOnly: boolean;
  topics: string[];
  formats: string[];
  timeOfDay: "Morning" | "Afternoon" | "Evening" | "Noon";
  partiful?: PartifulData;
  /** Co-host labels from the official listing (SF edition onward) */
  hosts?: string[];
  imageUrl?: string | null;
  /** "open" | "closed" | null — from the official listing */
  registrationStatus?: string | null;
  isFeatured?: boolean;
}

const TOPIC_RULES: Record<string, string[]> = {
  "AI/ML": [
    "ai ",
    " ai",
    "artificial intelligence",
    "machine learning",
    " ml ",
    "llm",
    "gpt",
    "genai",
    "generative",
    "deep learning",
    "neural",
    "chatbot",
    "agentic",
    "agent ",
    " agents",
    "openai",
    "anthropic",
    "claude",
    "automation",
    "computer vision",
    "nlp",
    "model",
  ],
  "VC/Investing": [
    "vc ",
    "venture",
    "investor",
    "investing",
    "fundrais",
    "capital",
    "pitch",
    "angel",
    "allocator",
    "fund ",
    "lp ",
    "gp ",
    "seed ",
    "series a",
    "series b",
    "portfolio",
    "family office",
  ],
  "Founder/Startup": [
    "founder",
    "startup",
    "entrepreneur",
    "building",
    "launch",
    "early-stage",
    "bootstrapp",
    "co-founder",
    "yc ",
    "techstars",
    "accelerator",
  ],
  "Social/Party": [
    "party",
    "happy hour",
    "mixer",
    "cocktail",
    "drinks",
    "rooftop",
    "brunch",
    "dinner",
    "social",
    "celebration",
    "afterparty",
    "soiree",
  ],
  "Dev/Engineering": [
    "developer",
    "engineering",
    "code",
    "hack",
    "devops",
    "infra",
    "open source",
    "api ",
    "backend",
    "frontend",
    "full stack",
    "software",
  ],
  Healthcare: [
    "health",
    "biotech",
    "medtech",
    "pharma",
    "wellness",
    "clinical",
    "patient",
    "medical",
    "care delivery",
  ],
  Fintech: [
    "fintech",
    "finance",
    "banking",
    "payments",
    "financial",
    "insurance",
    "insurtech",
    "lending",
  ],
  "Design/Creative": [
    "design",
    "creative",
    "art ",
    " art",
    "music",
    "fashion",
    "brand",
    "ux ",
    "ui ",
  ],
  "Women/Diversity": [
    "women",
    "female",
    "diversity",
    "dei",
    "inclusion",
    "latinx",
    "black ",
    "lgbtq",
    "queer",
    "underrepresented",
  ],
  "Media/Content": [
    "media",
    "content",
    "creator",
    "podcast",
    "journalism",
    "newsletter",
    "publishing",
  ],
  "Sports/Fitness": [
    "run ",
    "running",
    "workout",
    "fitness",
    "basketball",
    "tennis",
    "pickleball",
    "golf",
    "yoga",
    "pilates",
    "hike",
    "walk ",
  ],
  "Climate/Energy": [
    "climate",
    "cleantech",
    "energy",
    "sustainability",
    "green",
    "carbon",
    "solar",
  ],
  "Product/Growth": [
    "product",
    "growth",
    "marketing",
    "gtm",
    "go-to-market",
    "acquisition",
    "retention",
    "seo",
    "plg",
  ],
  "Real Estate": [
    "real estate",
    "proptech",
    "housing",
    "construction",
    "commercial real",
  ],
  "Crypto/Web3": [
    "crypto",
    "web3",
    "blockchain",
    "defi",
    "bitcoin",
    "ethereum",
    "token",
    "nft",
    "solana",
    "decentralized",
  ],
  Legal: ["legal", "law ", "compliance", "regulation", "policy"],
  Consumer: [
    "consumer",
    "b2c",
    "e-commerce",
    "ecommerce",
    "retail",
    "cpg",
    "d2c",
    "dtc",
    "marketplace",
  ],
  SaaS: ["saas", "b2b", "enterprise", "sales ", "crm"],
};

const FORMAT_RULES: Record<string, string[]> = {
  "Panel/Talk": [
    "panel",
    "talk",
    "fireside",
    "keynote",
    "speaker",
    "discussion",
    "conversation",
    "forum",
  ],
  Workshop: ["workshop", "bootcamp", "masterclass", "hands-on", "hands on"],
  Hackathon: ["hackathon", "hack "],
  "Demo Day": ["demo day", "demo night", "showcase", "exhibition"],
  Conference: ["conference", "summit", "symposium"],
  "Networking/Mixer": [
    "mixer",
    "networking",
    "meet and greet",
    "mingle",
    "connect",
    "meetup",
  ],
  "Dinner/Drinks": [
    "dinner",
    "happy hour",
    "cocktail",
    "drinks",
    "brunch",
    "lunch",
    "reception",
    "supper",
  ],
  Party: ["party", "bash", "afterparty", "soiree", "celebration", "gala"],
  Fitness: [
    "run ",
    "running",
    "workout",
    "yoga",
    "pilates",
    "tennis",
    "pickleball",
    "basketball",
    "hike",
    "walk",
  ],
};

function matchKeywords(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

export function classifyEvent(
  name: string,
  company: string
): { topics: string[]; formats: string[] } {
  const text = ` ${name.toLowerCase()} ${company.toLowerCase()} `;

  const topics = Object.entries(TOPIC_RULES)
    .filter(([, keywords]) => matchKeywords(text, keywords))
    .map(([topic]) => topic);

  const formats = Object.entries(FORMAT_RULES)
    .filter(([, keywords]) => matchKeywords(text, keywords))
    .map(([format]) => format);

  return { topics, formats };
}

/**
 * Time-of-day bucket from the official listing's label, with one fix: events
 * at 12am-5am are labelled "Evening" upstream, which pollutes the Evening
 * filter, so they're bucketed as Morning instead.
 */
export function bucketTimeOfDay(
  label: string | null | undefined,
  time: string | null | undefined
): TechWeekEvent["timeOfDay"] {
  if (time) {
    const hour = parseInt(time.split(":")[0], 10);
    if (hour >= 0 && hour < 6) return "Morning";
  }
  return (label as TechWeekEvent["timeOfDay"]) ?? "Evening";
}

export const TOPICS = Object.keys(TOPIC_RULES);
export const FORMATS = Object.keys(FORMAT_RULES);

export const TOPIC_COLORS: Record<string, string> = {
  "AI/ML": "bg-gray-900 text-white border-gray-900",
  "Dev/Engineering": "bg-gray-900 text-white border-gray-900",
  SaaS: "bg-gray-900 text-white border-gray-900",
  "Product/Growth": "bg-gray-900 text-white border-gray-900",
  "Crypto/Web3": "bg-gray-900 text-white border-gray-900",
  Fintech: "bg-gray-900 text-white border-gray-900",
  "VC/Investing": "bg-gray-900 text-white border-gray-900",
  "Founder/Startup": "bg-gray-900 text-white border-gray-900",
  "Climate/Energy": "bg-gray-900 text-white border-gray-900",
  "Sports/Fitness": "bg-gray-900 text-white border-gray-900",
  Healthcare: "bg-gray-900 text-white border-gray-900",
  "Women/Diversity": "bg-gray-900 text-white border-gray-900",
  Legal: "bg-gray-900 text-white border-gray-900",
  Consumer: "bg-gray-900 text-white border-gray-900",
  "Real Estate": "bg-gray-900 text-white border-gray-900",
  "Social/Party": "bg-gray-900 text-white border-gray-900",
  "Design/Creative": "bg-gray-900 text-white border-gray-900",
  "Media/Content": "bg-gray-900 text-white border-gray-900",
};
