/**
 * The privacy policy and terms of service, as static in-app pages.
 * Plain sections of paragraphs — edit the text here to update the app.
 * (These are drafts for review; they are not legal advice.)
 */

export type LegalKind = "privacy" | "terms";

export interface LegalSection {
  title: string;
  paragraphs: string[];
}

export const LEGAL_TITLES: Record<LegalKind, string> = {
  privacy: "Privacy Policy",
  terms: "Terms of Service",
};

export const PRIVACY_POLICY: LegalSection[] = [
  {
    title: "Where your data lives",
    paragraphs: [
      "meetwrite is a local-first macOS app. Your notes, transcripts, chats, enhanced versions, recordings, and settings are stored on your own Mac — in a local database file and a local audio file. There is no meetwrite account and no meetwrite server.",
    ],
  },
  {
    title: "What leaves your Mac",
    paragraphs: [
      "When you record, enhance, or chat, the text and audio needed for that feature are sent to OpenAI using the OpenAI API key you provide. That traffic is directly between your Mac and OpenAI, and is governed by OpenAI's terms and policies. meetwrite never receives, stores, or sees your data.",
      "Your API key is stored in the macOS Keychain under meetwrite, and only the app on this Mac reads it.",
    ],
  },
  {
    title: "Deleting your data",
    paragraphs: [
      "Deleting a note removes its notes, transcript, chats, enhanced versions, and its recording. Deleting the app and its application-support folder removes everything else.",
    ],
  },
  {
    title: "Analytics and sharing",
    paragraphs: [
      "meetwrite has no analytics, no telemetry, no ads, and nothing is ever sold or shared. What you write stays yours.",
    ],
  },
];

export const TERMS_OF_SERVICE: LegalSection[] = [
  {
    title: "Using meetwrite",
    paragraphs: [
      "meetwrite is provided as-is, without warranty of any kind, to the extent permitted by law. We are not liable for lost notes, missed recordings, or any other consequence of using the app.",
    ],
  },
  {
    title: "OpenAI usage",
    paragraphs: [
      "meetwrite works with your own OpenAI API key. You are responsible for the usage and charges on that key, and for complying with OpenAI's own terms.",
    ],
  },
  {
    title: "Recording consent",
    paragraphs: [
      "You are responsible for obtaining the consent required to record a meeting under the laws that apply to you and the other participants.",
    ],
  },
  {
    title: "Changes",
    paragraphs: [
      "These terms and the privacy policy may be updated along with app updates; the version in the installed app is the one that applies.",
    ],
  },
];

export function legalSections(kind: LegalKind): LegalSection[] {
  return kind === "privacy" ? PRIVACY_POLICY : TERMS_OF_SERVICE;
}
