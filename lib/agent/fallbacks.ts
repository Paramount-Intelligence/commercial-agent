import { resolveAgentUserName } from '../auth/agentUserName';

export type PersonaFallbackType =
  | 'general'
  | 'company'
  | 'pricing'
  | 'contact'
  | 'lead'
  | 'document'
  | 'overload';

type User = { name: string | null; email: string; affiliation: string | null };

const STATIC: Record<Exclude<PersonaFallbackType, 'lead' | 'contact' | 'company'>, string[]> = {
  general: [
    "I couldn't give that a reliable answer just now. Try the question once more and I'll take a clean pass at it.",
    "That answer didn't clear our checks. Please ask again and I'll respond more directly.",
    "I wasn't able to land that answer safely. Rephrase it once and I'll try again.",
    "I need another pass to answer that properly. Send the request again and I'll keep it focused.",
  ],
  pricing: [
    "Our indicative ranges are $90-$200 per hour for delivery and $150-$250 for advisory. Fractional work may receive a 10%-30% discount based on duration and utilization; a formal quote follows scoping.",
    "Indicatively, delivery is $90-$200 per hour and advisory is $150-$250. Fractional or ongoing work may qualify for a 10%-30% discount, with final terms scoped by the team.",
    "The approved ranges are $90-$200 per hour for delivery and $150-$250 for advisory, with a possible 10%-30% discount for fractional work. They are indicative and subject to scoping.",
    "For planning, use $90-$200 per hour for delivery and $150-$250 for advisory. Duration and utilization can support a 10%-30% fractional-work discount; we confirm a formal price after scoping.",
  ],
  document: [
    "I couldn't generate that document just now, so I won't call it ready. Please try the request again.",
    "That document did not finish generating. Try once more and I'll attempt it again.",
    "I wasn't able to create the file reliably this time. Please resend the request and I'll retry it.",
    "The document isn't ready because generation did not complete. Ask again and I'll take another pass.",
  ],
  overload: [
    "I'm having trouble reaching the model right now. Please try again in a moment and I'll pick this up cleanly.",
    "The service is under unusual load just now. Give it a moment, then try again and I'll take another pass.",
    "I couldn't complete that response because the model service is busy. Please retry shortly and I'll help from there.",
    "The model connection timed out before I could answer. Try again in a moment and I'll continue with you.",
  ],
};

function companyVariants(request: string): string[] {
  if (/\b(?:bykea|baikeya|vaikea|ikea)\b/i.test(request)) {
    return [
      'Bykea is not a Paramount client. Ali worked there before founding Paramount, and that background is separate from every Paramount case.',
      "No, Bykea was not a Paramount client. It was part of Ali's career before he founded Paramount; I won't link a Paramount case to it.",
      "Bykea belongs to Ali's pre-Paramount employment history, not Paramount's client list. There is no Paramount case I can connect to it.",
      "Paramount did not deliver a case for Bykea. Ali's earlier employment there is a separate personal background fact.",
    ];
  }
  if (/\b(?:jazz(?:cash)?|mobilink|veon)\b/i.test(request)) {
    return [
      "That company is part of Ali's pre-Paramount background, not a Paramount client. I won't connect a Paramount case or metric to it.",
      "No Paramount client relationship is established there. Ali's earlier employment is separate from the firm's delivery record.",
      "That is founder employment history, not a Paramount engagement. Any Paramount case must remain separate.",
      "I can confirm the employer and Paramount are separate in this context. I can't attach a Paramount case or outcome to it.",
    ];
  }
  return [
    "I don't have enough approved evidence to make that specific company or founder claim. I can try the question again or connect you with the Paramount team.",
    "I can't verify that company detail well enough to state it. Please try again, or I can point you to an approved Paramount contact.",
    "That company claim isn't supported clearly enough for me to repeat. Ask once more and I'll give you only what we can substantiate.",
    "I couldn't ground that founder or company detail reliably. I can retry it, or help you reach the team for confirmation.",
  ];
}

function contactVariants(request: string): string[] {
  if (/\bali(?:'s|s)?\b[\s\S]{0,40}\b(?:phone|number|mobile|cell)\b/i.test(request)) {
    return [
      "We don't share a phone number for Ali. You can reach him at ali@paramountintelligence.co.",
      "Ali's phone number isn't available for sharing, but his approved email is ali@paramountintelligence.co.",
      'I cannot provide a direct number for Ali. The right contact is ali@paramountintelligence.co.',
      'Ali is available by email at ali@paramountintelligence.co; I do not share a phone number for him.',
    ];
  }
  return [
    "You can reach Ali at ali@paramountintelligence.co or Marty at marty@paramountintelligence.co. Marty's phone is 443.494.9144; we don't share a phone number for Ali.",
    "The approved contacts are ali@paramountintelligence.co and marty@paramountintelligence.co. For a phone call, Marty is available at 443.494.9144; Ali's phone is not shared.",
    "Email Ali at ali@paramountintelligence.co or Marty at marty@paramountintelligence.co. Marty's approved number is 443.494.9144, and Ali is available by email only.",
    "For the team, use ali@paramountintelligence.co or marty@paramountintelligence.co. You can also call Marty on 443.494.9144; I can't provide a phone number for Ali.",
  ];
}

function leadVariants(user: User): string[] {
  const email = user.email.trim();
  const name = resolveAgentUserName(user.name, email);
  const company = user.affiliation?.trim();
  const identity = name
    ? `${name}${company ? ` at ${company}` : ''}, at ${email}`
    : `${email}${company ? ` at ${company}` : ''}`;
  return [
    `I can arrange the follow-up. I have you as ${identity}; is that right, and what should the team know?`,
    `Let's make the handoff useful. I have ${identity} on file; please confirm that and tell me the topic.`,
    `I can pass this to the Paramount team once the topic is clear. I have ${identity}; what should I include?`,
    `Happy to set up the follow-up. Please confirm ${identity} is correct and tell me what you want the team to discuss.`,
  ];
}

export function personaFallback(
  type: PersonaFallbackType,
  previousFallbackTexts: readonly string[],
  user: User,
  userRequest = '',
): string {
  const variants = type === 'lead'
    ? leadVariants(user)
    : type === 'company'
      ? companyVariants(userRequest)
      : type === 'contact'
        ? contactVariants(userRequest)
        : STATIC[type];
  const previous = new Set(previousFallbackTexts.map((text) => text.trim()));
  const unused = variants.find((variant) => !previous.has(variant));
  if (unused) return unused;
  // A conversation needing every variant is unhealthy; switch to a unique,
  // safe escalation rather than repeat a canned sentence.
  return `I still can't complete this ${type} request reliably in this conversation. Please start a fresh chat or email marty@paramountintelligence.co, and the team can take it from there.`;
}
