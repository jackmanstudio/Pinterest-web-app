import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Terms of Service · Pinterest AI Studio" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <h2>Using the service</h2>
      <p>Pinterest AI Studio helps you write, design, organise and schedule Pinterest pins. You must be old enough to form a binding contract and keep your login details private.</p>
      <h2>Your content and your Pinterest account</h2>
      <ul>
        <li>You own the pins, text and images you create here. You are responsible for checking them before they are published.</li>
        <li>Nothing is published, scheduled, edited or deleted on Pinterest without your approval. Autopilot publishes only after you turn it on with an explicit consent.</li>
        <li>You must follow Pinterest&apos;s own terms and community guidelines. You can disconnect Pinterest at any time.</li>
      </ul>
      <h2>AI-generated content</h2>
      <p>Text and images may be produced by AI providers. They can be inaccurate or similar to other content; review them before use. Demo output is labelled as such.</p>
      <h2>Acceptable use</h2>
      <p>Don&apos;t use the service for spam, misleading pins, unlawful content, or to access other people&apos;s data.</p>
      <h2>Closing your account</h2>
      <p>You can export your data and delete your account from Account settings. Deletion removes your data from this app; pins already live on Pinterest stay there until you remove them.</p>
      <h2>Changes</h2>
      <p>We may update these terms and will show the date of the latest version here.</p>
    </LegalPage>
  );
}
