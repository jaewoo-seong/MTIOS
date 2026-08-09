import { BusinessOS } from "@/components/business-os";
import { HelpProvider } from "@/components/help-provider";
import { I18nProvider } from "@/lib/i18n";

export default function Home() {
  return (
    <I18nProvider>
      <HelpProvider><BusinessOS /></HelpProvider>
    </I18nProvider>
  );
}
