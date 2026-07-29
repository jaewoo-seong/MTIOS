import { BusinessOS } from "@/components/business-os";
import { I18nProvider } from "@/lib/i18n";

export default function Home() {
  return <I18nProvider><BusinessOS /></I18nProvider>;
}
