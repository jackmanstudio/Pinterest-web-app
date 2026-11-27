/** Account pages a new user can open from the menu before adding an account. */
export const START_PAGES: Record<string, { label: string; about: string }> = {
  studio: { label: "Studio", about: "Type one idea and get finished pins: title, description, tags and a designed image." },
  drafts: { label: "Pin library", about: "Every pin you make, with filters, downloads and quick edits." },
  tools: { label: "Tools", about: "Pin health checks, other sizes, season timing and more helpers." },
  publish: { label: "Review & publish", about: "Approve pins and send them to Pinterest, one by one or all at once." },
  calendar: { label: "Calendar", about: "See and move scheduled pins across the month." },
  boards: { label: "Boards", about: "Your Pinterest boards, sorted into categories, with checks." },
  autopilot: { label: "Autopilot", about: "Let the app make and schedule pins for you every day." },
  analytics: { label: "Analytics", about: "Impressions, saves and clicks once Pinterest is connected." },
  usage: { label: "Usage & cost", about: "How much AI writing and images have cost, against your budget." },
  settings: { label: "Brand & categories", about: "Your colours, fonts, website and the categories you post in." },
  pinterest: { label: "Pinterest", about: "Connect the Pinterest account so pins can be published." },
};

export const startPath = (section: string) => (section === "studio" ? "" : `/${section}`);
