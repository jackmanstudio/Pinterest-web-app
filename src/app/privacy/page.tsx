import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Privacy Policy · Pinterest AI Studio" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <h2>What we store</h2>
      <ul>
        <li>Account: your name, email and a hashed password (handled by our authentication provider, Supabase; we never see or store your password in plain text).</li>
        <li>Your work: keywords, drafts, images, boards, schedules and settings, visible only to your account.</li>
        <li>Pinterest connection: access tokens, encrypted with AES-256-GCM before storage, never sent to your browser.</li>
        <li>Usage and activity logs needed to run and secure the service (for example, AI cost totals and publishing history).</li>
      </ul>
      <h2>Who processes it</h2>
      <p>Hosting (Vercel), database and authentication (Supabase), Pinterest (only when you connect it), and the AI providers you enable for text and images. Pin text and keywords are sent to the AI provider to generate content.</p>
      <h2>Your choices</h2>
      <ul>
        <li>Export all your data or delete your account from Account settings.</li>
        <li>Disconnect Pinterest from the Pinterest page of each account.</li>
        <li>Choose which emails you get under notification preferences.</li>
      </ul>
      <h2>Security</h2>
      <p>Traffic uses HTTPS. Every table is protected by row-level security so one user can&apos;t read another&apos;s data. Sign-in and sign-up are rate limited.</p>
      <h2>Contact</h2>
      <p>Questions about your data: use the contact address published by the operator of this service.</p>
    </LegalPage>
  );
}
