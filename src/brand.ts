// All user-visible brand strings. Change the name or tagline here only.
export const BRAND = {
  name: 'Roadtrip Radio',
  tagline: 'Music radio across America',
  description:
    'Roadtrip Radio is a free map of US music radio stations you can play in the browser. No accounts, no tracking.',
  /** Document title: name, em dash, tagline. */
  get title() {
    return `${this.name} — ${this.tagline}`;
  },
} as const;
