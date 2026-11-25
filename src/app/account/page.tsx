import { AccountData } from "@/components/AccountData";
import { AccountSettings } from "@/components/AccountSettings";

export const metadata = { title: "Account · Pinterest AI Studio" };

export default function AccountPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10 py-2">
      <AccountSettings />
      <AccountData />
    </div>
  );
}
